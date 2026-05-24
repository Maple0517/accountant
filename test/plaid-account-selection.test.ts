import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mapPlaidType,
  parseSelectedPlaidAccountIds,
  reconcilePlaidItemAccounts,
  type PlaidAccountSelectionClient,
} from '@/lib/plaid/account-selection'

type Row = Record<string, unknown>
type Filter = {
  method: 'eq' | 'in' | 'is'
  column: string
  value: unknown
}
type Operation = {
  table: string
  action: 'select' | 'update' | 'insert'
  payload?: Record<string, unknown> | Record<string, unknown>[]
  filters: Filter[]
  single: boolean
}
type MockDb = Record<string, Row[]>

function matchesFilters(row: Row, filters: Filter[]) {
  return filters.every((filter) => {
    if (filter.method === 'eq' || filter.method === 'is') {
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

    const payload = Array.isArray(operation.payload) ? operation.payload : [operation.payload ?? {}]
    db[operation.table] = rows.concat(payload)
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
    insert(payload: Record<string, unknown>[]) {
      operation.action = 'insert'
      operation.payload = payload
      return query
    },
    eq(column: string, value: unknown) {
      operation.filters.push({ method: 'eq', column, value })
      return query
    },
    is(column: string, value: unknown) {
      operation.filters.push({ method: 'is', column, value })
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

  return { supabase: supabase as PlaidAccountSelectionClient, db, operations }
}

const plaidChecking = {
  account_id: 'pa_checking',
  name: 'Everyday Checking',
  official_name: 'Everyday Checking',
  type: 'depository',
  subtype: 'checking',
  mask: '1111',
  balances: {
    current: 100,
    available: 90,
    iso_currency_code: 'USD',
  },
} as never

const plaidCredit = {
  account_id: 'pa_credit',
  name: 'Rewards Card',
  official_name: 'Rewards Card',
  type: 'credit',
  subtype: 'credit card',
  mask: '2222',
  balances: {
    current: 50,
    available: 950,
    iso_currency_code: 'USD',
  },
} as never

test('parseSelectedPlaidAccountIds accepts only string arrays and deduplicates ids', () => {
  assert.deepEqual(parseSelectedPlaidAccountIds({ selected_plaid_account_ids: ['a', 'a', 'b'] }), ['a', 'b'])
  assert.equal(parseSelectedPlaidAccountIds({ selected_plaid_account_ids: ['a', 1] }), null)
  assert.equal(parseSelectedPlaidAccountIds({}), null)
})

test('mapPlaidType maps common Plaid account types', () => {
  assert.equal(mapPlaidType('depository', 'savings'), 'savings')
  assert.equal(mapPlaidType('depository', 'checking'), 'checking')
  assert.equal(mapPlaidType('credit', null), 'credit')
  assert.equal(mapPlaidType('investment', null), 'investment')
  assert.equal(mapPlaidType('loan', null), 'other')
})

test('reconcilePlaidItemAccounts disconnects only unselected accounts', async () => {
  const { supabase, db } = createSupabaseMock({
    plaid_items: [{ id: 'item_1', user_id: 'user_1', access_token: 'access-token' }],
    accounts: [
      {
        id: 'account_checking',
        user_id: 'user_1',
        plaid_item_id: 'item_1',
        plaid_account_id: 'pa_checking',
        name: 'Everyday Checking',
        type: 'checking',
        subtype: 'checking',
        mask: '1111',
        is_manual: false,
      },
      {
        id: 'account_credit',
        user_id: 'user_1',
        plaid_item_id: 'item_1',
        plaid_account_id: 'pa_credit',
        name: 'Rewards Card',
        type: 'credit',
        subtype: 'credit card',
        mask: '2222',
        is_manual: false,
      },
    ],
  })

  const result = await reconcilePlaidItemAccounts({
    supabase,
    userId: 'user_1',
    plaidItemId: 'item_1',
    selectedPlaidAccountIds: ['pa_checking'],
    getPlaidAccounts: async () => [plaidChecking, plaidCredit],
  })

  assert.equal(result.disconnected_accounts, 1)
  assert.equal(db.accounts.find((account) => account.id === 'account_checking')?.plaid_item_id, 'item_1')
  assert.equal(db.accounts.find((account) => account.id === 'account_credit')?.plaid_item_id, null)
  assert.equal(db.accounts.find((account) => account.id === 'account_credit')?.plaid_account_id, null)
})

test('reconcilePlaidItemAccounts reconnects a previously disconnected matching account', async () => {
  const { supabase, db } = createSupabaseMock({
    plaid_items: [{ id: 'item_1', user_id: 'user_1', access_token: 'access-token' }],
    accounts: [
      {
        id: 'account_credit',
        user_id: 'user_1',
        plaid_item_id: null,
        plaid_account_id: null,
        name: 'Rewards Card',
        type: 'credit',
        subtype: 'credit card',
        mask: '2222',
        is_manual: false,
      },
    ],
  })

  const result = await reconcilePlaidItemAccounts({
    supabase,
    userId: 'user_1',
    plaidItemId: 'item_1',
    selectedPlaidAccountIds: ['pa_credit'],
    getPlaidAccounts: async () => [plaidCredit],
  })

  assert.equal(result.reconnected_accounts, 1)
  assert.equal(result.added_accounts, 0)
  assert.equal(db.accounts.length, 1)
  assert.equal(db.accounts[0].plaid_item_id, 'item_1')
  assert.equal(db.accounts[0].plaid_account_id, 'pa_credit')
})
