import test from 'node:test'
import assert from 'node:assert/strict'

import {
  updateTransactionSemantics,
  type TransactionSemanticsClient,
} from '@/lib/transactions/semantic-update'

type Operation = {
  table: string
  action: 'select' | 'update'
  columns?: string
  payload?: Record<string, unknown>
  filters: Array<{
    method: 'eq' | 'neq' | 'is'
    column: string
    value: unknown
  }>
  single: boolean
}

type MockTransaction = {
  id: string
  user_id: string
  date: string
  amount: number
  category_id: string | null
  treatment?: string | null
  refund_source?: string | null
  transfer_group_id: string | null
  deleted_at?: string | null
  is_hidden_from_reports?: boolean | null
  split_role?: 'none' | 'parent' | 'child' | null
  split_group_id?: string | null
  split_parent_id?: string | null
  categories: {
    type: 'income' | 'expense' | 'transfer' | null
    is_excluded_from_budget: boolean | null
  } | null
}

type MockOptions = {
  transaction: MockTransaction
  updateErrorOn?: number
}

function createQuery(
  operation: Operation,
  resolve: () => Promise<{ data: unknown | null; error: { message: string } | null }>
) {
  const query = {
    select(columns: string) {
      if (!operation.payload) {
        operation.action = 'select'
      }
      operation.columns = columns
      return query
    },
    update(payload: Record<string, unknown>) {
      operation.action = 'update'
      operation.payload = payload
      return query
    },
    eq(column: string, value: unknown) {
      operation.filters.push({ method: 'eq', column, value })
      return query
    },
    neq(column: string, value: unknown) {
      operation.filters.push({ method: 'neq', column, value })
      return query
    },
    is(column: string, value: null) {
      operation.filters.push({ method: 'is', column, value })
      return query
    },
    single() {
      operation.single = true
      return resolve()
    },
    then<TResult1 = { data: unknown | null; error: { message: string } | null }, TResult2 = never>(
      onfulfilled?: (
        value: { data: unknown | null; error: { message: string } | null }
      ) => TResult1 | PromiseLike<TResult1>,
      onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>
    ) {
      return resolve().then(onfulfilled, onrejected)
    },
  }

  return query
}

function createSupabaseMock(options: MockOptions) {
  const operations: Operation[] = []
  const updatePayloads: Record<string, unknown>[] = []
  let updateCount = 0

  const supabase = {
    from(table: string) {
      const operation: Operation = {
        table,
        action: 'select',
        filters: [],
        single: false,
      }
      operations.push(operation)

      return createQuery(operation, async () => {
        if (operation.action === 'select' && operation.single) {
          const isInitialTransactionLoad =
            operation.filters.some(
              (filter) => filter.method === 'eq' && filter.column === 'id'
            ) &&
            operation.filters.some(
              (filter) => filter.method === 'eq' && filter.column === 'user_id'
            )

          if (isInitialTransactionLoad && !operation.payload) {
            return { data: options.transaction, error: null }
          }
        }

        if (operation.action === 'update') {
          updateCount += 1
          updatePayloads.push(operation.payload ?? {})

          if (options.updateErrorOn === updateCount) {
            return { data: null, error: { message: 'mock update failed' } }
          }

          if (operation.single) {
            return {
              data: {
                ...options.transaction,
                ...operation.payload,
              },
              error: null,
            }
          }

          return { data: null, error: null }
        }

        return { data: null, error: null }
      })
    },
  }

  return {
    supabase: supabase as TransactionSemanticsClient,
    operations,
    updatePayloads,
  }
}

const baseTransaction: MockTransaction = {
  id: 'tx_current',
  user_id: 'user_1',
  date: '2026-05-10',
  amount: 50,
  category_id: 'cat_food',
  treatment: 'spending',
  refund_source: null,
  transfer_group_id: 'group_1',
  categories: {
    type: 'expense',
    is_excluded_from_budget: false,
  },
}

test('confirming a suggested transfer updates the matching group leg', async () => {
  const { supabase, operations, updatePayloads } = createSupabaseMock({
    transaction: baseTransaction,
  })
  const ensuredCategories: string[] = []

  const result = await updateTransactionSemantics({
    supabase,
    userId: 'user_1',
    transactionId: 'tx_current',
    body: { transfer_match_status: 'manually_matched' },
    ensureCategory: async (_client, _userId, categoryInfo) => {
      ensuredCategories.push(categoryInfo.name)
      return { id: 'cat_transfer' }
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(ensuredCategories, ['Transfer'])
  assert.equal(updatePayloads.length, 2)
  assert.deepEqual(updatePayloads[0], {
    semantic_override_source: 'user',
    treatment: 'transfer',
    refund_source: null,
    transfer_match_status: 'manually_matched',
  })
  assert.deepEqual(updatePayloads[1], {
    semantic_override_source: 'user',
    treatment: 'transfer',
    refund_source: null,
    category_id: 'cat_transfer',
    transfer_match_status: 'manually_matched',
  })

  const groupUpdate = operations.find(
    (operation) =>
      operation.action === 'update' &&
      operation.filters.some(
        (filter) =>
          filter.method === 'eq' &&
          filter.column === 'transfer_group_id' &&
          filter.value === 'group_1'
      )
  )

  assert.ok(groupUpdate)
  assert.deepEqual(groupUpdate.filters, [
    { method: 'eq', column: 'user_id', value: 'user_1' },
    { method: 'eq', column: 'transfer_group_id', value: 'group_1' },
    { method: 'neq', column: 'id', value: 'tx_current' },
    { method: 'is', column: 'deleted_at', value: null },
    { method: 'neq', column: 'split_role', value: 'parent' },
  ])
})

test('rejecting a transfer clears group metadata and marks both legs ignored', async () => {
  const { supabase, updatePayloads } = createSupabaseMock({
    transaction: {
      ...baseTransaction,
      treatment: 'transfer',
      categories: {
        type: 'transfer',
        is_excluded_from_budget: true,
      },
    },
  })

  const result = await updateTransactionSemantics({
    supabase,
    userId: 'user_1',
    transactionId: 'tx_current',
    body: {
      treatment: 'spending',
      transfer_match_status: 'ignored',
    },
    ensureCategory: async () => {
      throw new Error('rejecting a match should not create categories')
    },
  })

  assert.equal(result.ok, true)
  assert.equal(updatePayloads.length, 2)
  assert.deepEqual(updatePayloads[0], {
    semantic_override_source: 'user',
    treatment: 'spending',
    refund_source: null,
    transfer_match_status: 'ignored',
    transfer_group_id: null,
    transfer_match_confidence: null,
    transfer_match_reason: null,
  })
  assert.deepEqual(updatePayloads[1], updatePayloads[0])
})

test('existing debt payment only updates the selected transaction', async () => {
  const { supabase, operations, updatePayloads } = createSupabaseMock({
    transaction: baseTransaction,
  })
  const ensuredCategories: string[] = []

  const result = await updateTransactionSemantics({
    supabase,
    userId: 'user_1',
    transactionId: 'tx_current',
    body: { existing_debt_payment: true },
    ensureCategory: async (_client, _userId, categoryInfo) => {
      ensuredCategories.push(categoryInfo.name)
      return { id: 'cat_debt' }
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(ensuredCategories, ['Debt Payment'])
  assert.equal(updatePayloads.length, 1)
  assert.deepEqual(updatePayloads[0], {
    semantic_override_source: 'user',
    treatment: 'spending',
    refund_source: null,
    category_id: 'cat_debt',
    transfer_group_id: null,
    transfer_match_status: null,
    transfer_match_confidence: null,
    transfer_match_reason: null,
  })
  assert.equal(
    operations.some((operation) =>
      operation.filters.some((filter) => filter.column === 'transfer_group_id')
    ),
    false
  )
})

test('legacy semantic inputs are rejected before database access', async () => {
  const { supabase, operations } = createSupabaseMock({
    transaction: baseTransaction,
  })

  const result = await updateTransactionSemantics({
    supabase,
    userId: 'user_1',
    transactionId: 'tx_current',
    body: { budget_behavior: 'count_as_income' },
    ensureCategory: async () => null,
  })

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: 'Legacy transaction semantics inputs are no longer supported',
  })
  assert.equal(operations.length, 0)
})

test('canonical semantics input no longer accepts conflicting legacy fields', async () => {
  const { supabase, updatePayloads, operations } = createSupabaseMock({
    transaction: {
      ...baseTransaction,
      treatment: 'transfer',
      categories: {
        type: 'transfer',
        is_excluded_from_budget: true,
      },
    },
  })

  const result = await updateTransactionSemantics({
    supabase,
    userId: 'user_1',
    transactionId: 'tx_current',
    body: {
      treatment: 'spending',
      transaction_kind: 'transfer',
      budget_behavior: 'exclude_as_transfer',
    },
    ensureCategory: async () => null,
  })

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: 'Legacy transaction semantics inputs are no longer supported',
  })
  assert.equal(updatePayloads.length, 0)
  assert.equal(operations.length, 0)
})

test('semantics update rejects split parent transactions', async () => {
  const { supabase, updatePayloads } = createSupabaseMock({
    transaction: {
      ...baseTransaction,
      split_role: 'parent',
    },
  })

  const result = await updateTransactionSemantics({
    supabase,
    userId: 'user_1',
    transactionId: 'tx_current',
    body: { treatment: 'refund' },
    ensureCategory: async () => null,
  })

  assert.deepEqual(result, {
    ok: false,
    status: 409,
    error: 'Split parent transactions cannot be edited directly',
  })
  assert.equal(updatePayloads.length, 0)
})
