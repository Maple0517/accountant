import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyBaseFilters,
  applySavedViewFilters,
  countAllPendingAiClassifications,
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

test('parsePositiveInt clamps invalid and excessive pagination input', () => {
  assert.equal(parsePositiveInt(null, 50, 100), 50)
  assert.equal(parsePositiveInt('-1', 50, 100), 50)
  assert.equal(parsePositiveInt('500', 50, 100), 100)
  assert.equal(parsePositiveInt('25', 50, 100), 25)
})

test('loadSavedViewCounts runs one head count query per saved view with shared filters', async () => {
  const { supabase, operations } = createCountSupabaseMock()

  const counts = await loadSavedViewCounts(supabase as never, {
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

  assert.deepEqual(Object.keys(counts).sort(), [...SAVED_VIEWS].sort())
  assert.equal(counts.all satisfies number, 7)
  assert.equal(operations.length, SAVED_VIEWS.length)
  assert.ok(
    operations.every(
      (operation) =>
        operation.table === 'transactions' &&
        operation.selectArgs[0] === 'id' &&
        JSON.stringify(operation.selectArgs[1]) === JSON.stringify({ count: 'exact', head: true }) &&
        operation.filters.some((filter) => filter.method === 'eq' && filter.column === 'user_id' && filter.value === 'user_1')
    )
  )
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
