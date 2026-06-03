import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyBaseFilters,
  applySavedViewFilters,
  countAllPendingAiClassifications,
  loadTransactionListCounts,
  loadSavedViewCounts,
  parsePositiveInt,
  SAVED_VIEWS,
  type SavedView,
} from '@/lib/transactions/list-filters'

type Operation = {
  table: string
  selectArgs: unknown[]
  filters: Array<{ method: string; column?: string; value?: unknown }>
}

function createCountSupabaseMock() {
  const operations: Operation[] = []

  const supabase = {
    from(table: string) {
      const operation: Operation = { table, selectArgs: [], filters: [] }
      operations.push(operation)
      const query = {
        select(...args: unknown[]) {
          operation.selectArgs = args
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
        or(value: string) {
          operation.filters.push({ method: 'or', value })
          return query
        },
        is(column: string, value: null) {
          operation.filters.push({ method: 'is', column, value })
          return query
        },
        in(column: string, value: readonly unknown[]) {
          operation.filters.push({ method: 'in', column, value })
          return query
        },
        gte(column: string, value: unknown) {
          operation.filters.push({ method: 'gte', column, value })
          return query
        },
        lte(column: string, value: unknown) {
          operation.filters.push({ method: 'lte', column, value })
          return query
        },
        order() {
          return query
        },
        range() {
          return query
        },
        then<TResult1 = { data: null; count: number; error: null }, TResult2 = never>(
          onfulfilled?: (value: { data: null; count: number; error: null }) => TResult1 | PromiseLike<TResult1>,
          onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>
        ) {
          return Promise.resolve({ data: null, count: 7, error: null }).then(
            onfulfilled,
            onrejected
          )
        },
      }
      return query
    },
  }

  return { supabase, operations }
}

function createRpcCountSupabaseMock(data: unknown, error: { message?: string; code?: string } | null = null) {
  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = []

  const supabase = {
    rpc(fn: string, params: Record<string, unknown>) {
      rpcCalls.push({ fn, params })
      return Promise.resolve({ data, error })
    },
  }

  return { supabase, rpcCalls }
}

test('parsePositiveInt clamps invalid and excessive pagination input', () => {
  assert.equal(parsePositiveInt(null, 50, 100), 50)
  assert.equal(parsePositiveInt('-1', 50, 100), 50)
  assert.equal(parsePositiveInt('500', 50, 100), 100)
  assert.equal(parsePositiveInt('25', 50, 100), 25)
})

test('loadTransactionListCounts uses one RPC for saved view counts and global AI pending count', async () => {
  const { supabase, rpcCalls } = createRpcCountSupabaseMock({
    view_counts: {
      all: 12,
      needs_review: 3,
      uncategorized: 2,
      ai_pending: 4,
      refunds: 1,
      transfers: 0,
      pending: 5,
      large: 6,
    },
    all_ai_pending_count: 9,
  })

  const result = await loadTransactionListCounts(supabase as never, {
    userId: 'user_1',
    search: 'coffee',
    sourceOrAccount: 'manual',
    category: 'uncategorized',
    currency: 'USD',
    dateFrom: '2026-05-01',
    dateTo: '2026-05-31',
    showHidden: false,
    showDeleted: false,
    showSplitParents: false,
    splitGroupId: '',
  })

  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0].fn, 'get_transaction_list_counts')
  assert.equal(rpcCalls[0].params.p_user_id, 'user_1')
  assert.equal(rpcCalls[0].params.p_search, 'coffee')
  assert.deepEqual(Object.keys(result.viewCounts).sort(), [...SAVED_VIEWS].sort())
  assert.equal(result.viewCounts.needs_review, 3)
  assert.equal(result.allAiPendingCount, 9)
})

test('loadSavedViewCounts reuses the aggregate list count RPC', async () => {
  const { supabase, rpcCalls } = createRpcCountSupabaseMock({
    view_counts: Object.fromEntries(SAVED_VIEWS.map((view) => [view, 7])),
    all_ai_pending_count: 11,
  })

  const counts = await loadSavedViewCounts(supabase as never, {
    userId: 'user_1',
    search: '',
    sourceOrAccount: 'all',
    category: 'all',
    currency: 'all',
    dateFrom: '',
    dateTo: '',
    showHidden: false,
    showDeleted: false,
    showSplitParents: false,
    splitGroupId: '',
  })

  assert.equal(rpcCalls.length, 1)
  assert.deepEqual(Object.keys(counts).sort(), [...SAVED_VIEWS].sort())
  assert.equal(counts.all, 7)
})

test('saved view filters keep the expensive counts isolated and reusable', () => {
  const { supabase, operations } = createCountSupabaseMock()
  const query = applyBaseFilters(
    supabase.from('transactions').select('id', { count: 'exact', head: true }) as never,
    {
      userId: 'user_1',
      search: '',
      sourceOrAccount: 'all',
      category: 'all',
      currency: 'all',
      dateFrom: '',
      dateTo: '',
      showHidden: false,
      showDeleted: false,
      showSplitParents: false,
      splitGroupId: '',
    }
  )

  applySavedViewFilters(query, 'needs_review' satisfies SavedView)

  assert.ok(operations[0].filters.some((filter) => filter.method === 'or'))
  assert.ok(
    operations[0].filters.some(
      (filter) =>
        filter.method === 'or' &&
        typeof filter.value === 'string' &&
        filter.value.includes('linked_transaction_id.is.null') &&
        filter.value.includes('refund_match_reason.neq.manual-reviewed')
    )
  )
  assert.equal(
    operations[0].filters.some(
      (filter) =>
        filter.method === 'or' &&
        typeof filter.value === 'string' &&
        (filter.value.includes('pending.eq.true') ||
          filter.value.includes('refund_match_confidence.lt'))
    ),
    false
  )
  assert.equal(
    operations[0].filters.some(
      (filter) =>
        filter.method === 'eq' &&
        filter.column === 'pending' &&
        filter.value === false
    ),
    true
  )
})

test('countAllPendingAiClassifications ignores page filters but keeps safe visibility filters', async () => {
  const { supabase, operations } = createCountSupabaseMock()

  const count = await countAllPendingAiClassifications(supabase as never, 'user_1')

  assert.equal(count, 7)
  assert.equal(operations.length, 1)
  assert.ok(
    operations[0].filters.some(
      (filter) =>
        filter.method === 'eq' &&
        filter.column === 'user_id' &&
        filter.value === 'user_1'
    )
  )
  assert.ok(
    operations[0].filters.some(
      (filter) =>
        filter.method === 'or' &&
        typeof filter.value === 'string' &&
        filter.value.includes('classification:ai-pending')
    )
  )
  assert.equal(
    operations[0].filters.some(
      (filter) => filter.method === 'eq' && filter.column === 'source'
    ),
    false
  )
})
