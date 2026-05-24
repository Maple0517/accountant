import test from 'node:test'
import assert from 'node:assert/strict'

import {
  disconnectPlaidItem,
  parsePlaidItemDisconnectMode,
  PlaidItemDisconnectError,
  type PlaidItemDisconnectClient,
} from '@/lib/plaid/item-disconnect'
import { handleDeletePlaidItemRequest } from '@/app/api/plaid/items/[id]/route'

type Row = Record<string, unknown>
type Filter = {
  method: 'eq' | 'in'
  column: string
  value: unknown
}
type Operation = {
  table: string
  action: 'select' | 'update' | 'delete'
  payload?: Record<string, unknown>
  filters: Filter[]
  single: boolean
}
type MockDb = Record<string, Row[]>

function matchesFilters(row: Row, filters: Filter[]) {
  return filters.every((filter) => {
    if (filter.method === 'eq') {
      return row[filter.column] === filter.value
    }

    return Array.isArray(filter.value) && filter.value.includes(row[filter.column])
  })
}

function createQuery(db: MockDb, operation: Operation) {
  const resolve = async () => {
    const rows = db[operation.table] || []

    if (operation.action === 'select') {
      const data = rows.filter((row) => matchesFilters(row, operation.filters))
      if (operation.single) {
        return {
          data: data[0] ?? null,
          error: data[0] ? null : { message: 'No rows found' },
        }
      }

      return { data, error: null }
    }

    if (operation.action === 'update') {
      for (const row of rows) {
        if (matchesFilters(row, operation.filters)) {
          Object.assign(row, operation.payload)
        }
      }

      return { data: null, error: null }
    }

    db[operation.table] = rows.filter((row) => !matchesFilters(row, operation.filters))
    return { data: null, error: null }
  }

  const query = {
    select() {
      operation.action = 'select'
      return query
    },
    update(payload: Record<string, unknown>) {
      operation.action = 'update'
      operation.payload = payload
      return query
    },
    delete() {
      operation.action = 'delete'
      return query
    },
    eq(column: string, value: unknown) {
      operation.filters.push({ method: 'eq', column, value })
      return query
    },
    in(column: string, values: unknown[]) {
      operation.filters.push({ method: 'in', column, value: values })
      return query
    },
    single() {
      operation.single = true
      return resolve()
    },
    then<TResult1 = Awaited<ReturnType<typeof resolve>>, TResult2 = never>(
      onfulfilled?: (value: Awaited<ReturnType<typeof resolve>>) => TResult1 | PromiseLike<TResult1>,
      onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>
    ) {
      return resolve().then(onfulfilled, onrejected)
    },
  }

  return query
}

function createSupabaseMock(initialDb: MockDb) {
  const operations: Operation[] = []
  const db = Object.fromEntries(
    Object.entries(initialDb).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))])
  ) as MockDb

  const supabase = {
    from(table: string) {
      const operation: Operation = {
        table,
        action: 'select',
        filters: [],
        single: false,
      }
      operations.push(operation)
      return createQuery(db, operation)
    },
  }

  return { supabase: supabase as PlaidItemDisconnectClient, db, operations }
}

const baseDb: MockDb = {
  plaid_items: [
    {
      id: 'item_1',
      user_id: 'user_1',
      access_token: 'access-token-1',
      institution_name: 'Demo Bank',
    },
    {
      id: 'item_2',
      user_id: 'user_2',
      access_token: 'access-token-2',
      institution_name: 'Other Bank',
    },
  ],
  accounts: [
    { id: 'account_1', user_id: 'user_1', plaid_item_id: 'item_1', plaid_account_id: 'pa_1' },
    { id: 'account_2', user_id: 'user_1', plaid_item_id: 'item_1', plaid_account_id: 'pa_2' },
    { id: 'account_other', user_id: 'user_2', plaid_item_id: 'item_2', plaid_account_id: 'pa_3' },
  ],
  transactions: [
    { id: 'tx_1', user_id: 'user_1', account_id: 'account_1', linked_transaction_id: null },
    { id: 'tx_2', user_id: 'user_1', account_id: 'account_2', linked_transaction_id: 'tx_1' },
    { id: 'tx_external_link', user_id: 'user_1', account_id: 'manual_account', linked_transaction_id: 'tx_1' },
    { id: 'tx_other', user_id: 'user_2', account_id: 'account_other', linked_transaction_id: null },
  ],
  ai_classification_job_items: [
    { id: 'job_item_1', user_id: 'user_1', transaction_id: 'tx_1' },
    { id: 'job_item_2', user_id: 'user_1', transaction_id: 'tx_2' },
    { id: 'job_item_other', user_id: 'user_2', transaction_id: 'tx_other' },
  ],
}

test('parsePlaidItemDisconnectMode defaults to preserving history', () => {
  assert.equal(parsePlaidItemDisconnectMode({}), 'preserve_history')
  assert.equal(parsePlaidItemDisconnectMode({ mode: 'delete_history' }), 'delete_history')
  assert.equal(parsePlaidItemDisconnectMode({ mode: 'surprise_me' }), null)
})

test('disconnectPlaidItem preserves historical accounts and transactions', async () => {
  const { supabase, db } = createSupabaseMock(baseDb)
  const removedTokens: string[] = []

  const result = await disconnectPlaidItem({
    supabase,
    userId: 'user_1',
    plaidItemId: 'item_1',
    mode: 'preserve_history',
    removePlaidItem: async (accessToken) => {
      removedTokens.push(accessToken)
    },
  })

  assert.deepEqual(removedTokens, ['access-token-1'])
  assert.equal(result.disconnected_accounts, 2)
  assert.equal(result.deleted_transactions, 0)
  assert.equal(db.plaid_items.some((item) => item.id === 'item_1'), false)
  assert.equal(db.transactions.some((transaction) => transaction.id === 'tx_1'), true)
  assert.deepEqual(
    db.accounts
      .filter((account) => account.user_id === 'user_1')
      .map((account) => [account.plaid_item_id, account.plaid_account_id]),
    [
      [null, null],
      [null, null],
    ]
  )
})

test('disconnectPlaidItem deletes selected connection history without touching other users', async () => {
  const { supabase, db } = createSupabaseMock(baseDb)

  const result = await disconnectPlaidItem({
    supabase,
    userId: 'user_1',
    plaidItemId: 'item_1',
    mode: 'delete_history',
    removePlaidItem: async () => {},
  })

  assert.equal(result.deleted_transactions, 2)
  assert.equal(db.plaid_items.some((item) => item.id === 'item_1'), false)
  assert.equal(db.accounts.some((account) => account.id === 'account_1'), false)
  assert.equal(db.accounts.some((account) => account.id === 'account_other'), true)
  assert.equal(db.transactions.some((transaction) => transaction.id === 'tx_1'), false)
  assert.equal(db.transactions.some((transaction) => transaction.id === 'tx_2'), false)
  assert.equal(db.transactions.some((transaction) => transaction.id === 'tx_other'), true)
  assert.equal(db.ai_classification_job_items.some((item) => item.transaction_id === 'tx_1'), false)
  assert.equal(
    db.transactions.find((transaction) => transaction.id === 'tx_external_link')?.linked_transaction_id,
    null
  )
})

test('disconnectPlaidItem does not mutate local data when Plaid removal fails', async () => {
  const { supabase, db } = createSupabaseMock(baseDb)

  await assert.rejects(
    () =>
      disconnectPlaidItem({
        supabase,
        userId: 'user_1',
        plaidItemId: 'item_1',
        mode: 'preserve_history',
        removePlaidItem: async () => {
          throw new Error('Plaid is down')
        },
      }),
    /Plaid is down/
  )

  assert.equal(db.plaid_items.some((item) => item.id === 'item_1'), true)
  assert.equal(db.accounts.find((account) => account.id === 'account_1')?.plaid_item_id, 'item_1')
  assert.equal(db.transactions.some((transaction) => transaction.id === 'tx_1'), true)
})

test('disconnectPlaidItem rejects connections outside the current user', async () => {
  const { supabase } = createSupabaseMock(baseDb)

  await assert.rejects(
    () =>
      disconnectPlaidItem({
        supabase,
        userId: 'user_1',
        plaidItemId: 'item_2',
        mode: 'preserve_history',
        removePlaidItem: async () => {},
      }),
    (error) =>
      error instanceof PlaidItemDisconnectError &&
      error.status === 404 &&
      error.message === 'Plaid connection not found'
  )
})

test('DELETE Plaid item route returns 401 when unauthenticated', async () => {
  const response = await handleDeletePlaidItemRequest(
    new Request('https://example.test/api/plaid/items/item_1', {
      method: 'DELETE',
      body: JSON.stringify({ mode: 'preserve_history' }),
    }),
    'item_1',
    {
      getUserId: async () => undefined,
      disconnect: async () => {
        throw new Error('should not disconnect')
      },
    }
  )

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { error: 'Unauthorized' })
})

test('DELETE Plaid item route rejects invalid modes before disconnecting', async () => {
  let disconnected = false

  const response = await handleDeletePlaidItemRequest(
    new Request('https://example.test/api/plaid/items/item_1', {
      method: 'DELETE',
      body: JSON.stringify({ mode: 'delete_a_little' }),
    }),
    'item_1',
    {
      getUserId: async () => 'user_1',
      disconnect: async () => {
        disconnected = true
        throw new Error('should not disconnect')
      },
    }
  )

  assert.equal(response.status, 400)
  assert.equal(disconnected, false)
  assert.deepEqual(await response.json(), { error: 'Invalid disconnect mode' })
})

test('DELETE Plaid item route maps missing user-owned connection to 404', async () => {
  const response = await handleDeletePlaidItemRequest(
    new Request('https://example.test/api/plaid/items/item_2', {
      method: 'DELETE',
      body: JSON.stringify({ mode: 'preserve_history' }),
    }),
    'item_2',
    {
      getUserId: async () => 'user_1',
      disconnect: async () => {
        throw new PlaidItemDisconnectError('Plaid connection not found', 404)
      },
    }
  )

  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: 'Plaid connection not found' })
})
