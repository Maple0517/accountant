import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeTransactionRow,
  runSemanticsBackfillCheck,
  summarizeSemanticsBackfill,
  type SemanticsBackfillClient,
  type SupabaseTransactionRow,
  type TransactionRow,
} from '../scripts/transaction-semantics-backfill-check'

type Operation = {
  table: string
  action: 'select' | 'update'
  payload?: Record<string, unknown>
  filters: Array<{
    column: string
    value: unknown
  }>
}

function makeRow(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    id: 'tx',
    user_id: 'user_1',
    category_id: 'cat_food',
    amount: 10,
    date: '2026-05-01',
    transaction_kind: 'normal',
    budget_behavior: 'count_as_spending',
    semantic_override_source: 'system',
    categories: {
      type: 'expense',
      is_excluded_from_budget: false,
    },
    ...overrides,
  }
}

function createBackfillSupabaseMock(rows: SupabaseTransactionRow[]) {
  const operations: Operation[] = []

  const supabase = {
    from(table: string) {
      const operation: Operation = {
        table,
        action: 'select',
        filters: [],
      }
      operations.push(operation)

      const query = {
        select() {
          operation.action = 'select'
          return query
        },
        order() {
          return query
        },
        limit() {
          return query
        },
        update(payload: Record<string, unknown>) {
          operation.action = 'update'
          operation.payload = payload
          return query
        },
        eq(column: string, value: unknown) {
          operation.filters.push({ column, value })
          return query
        },
        then<TResult1 = { data: SupabaseTransactionRow[] | null; error: null }, TResult2 = never>(
          onfulfilled?: (
            value: { data: SupabaseTransactionRow[] | null; error: null }
          ) => TResult1 | PromiseLike<TResult1>,
          onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>
        ) {
          if (operation.action === 'update') {
            return Promise.resolve({ data: null, error: null }).then(
              onfulfilled as never,
              onrejected
            )
          }

          return Promise.resolve({ data: rows, error: null }).then(
            onfulfilled,
            onrejected
          )
        },
      }

      return query
    },
  }

  return {
    supabase: supabase as SemanticsBackfillClient,
    operations,
  }
}

test('normalizes Supabase nested category arrays', () => {
  const normalized = normalizeTransactionRow({
    ...makeRow({ id: 'tx_array' }),
    categories: [
      {
        type: 'transfer',
        is_excluded_from_budget: true,
      },
    ],
  })

  assert.deepEqual(normalized.categories, {
    type: 'transfer',
    is_excluded_from_budget: true,
  })
})

test('summarizes missing and mismatched system budget behavior', () => {
  const summary = summarizeSemanticsBackfill([
    makeRow({ id: 'missing', budget_behavior: null }),
    makeRow({
      id: 'wrong_system',
      budget_behavior: 'count_as_income',
      categories: {
        type: 'expense',
        is_excluded_from_budget: false,
      },
    }),
    makeRow({
      id: 'wrong_user',
      budget_behavior: 'count_as_income',
      semantic_override_source: 'user',
      categories: {
        type: 'expense',
        is_excluded_from_budget: false,
      },
    }),
    makeRow({
      id: 'ok_transfer',
      budget_behavior: 'exclude_as_transfer',
      categories: {
        type: 'transfer',
        is_excluded_from_budget: true,
      },
    }),
  ])

  assert.equal(summary.missing.length, 1)
  assert.equal(summary.systemMismatches.length, 1)
  assert.equal(summary.rowsToApply.map((tx) => tx.id).join(','), 'missing,wrong_system')
  assert.deepEqual(summary.summary, {
    scanned: 4,
    missing_budget_behavior: 1,
    system_mismatches: 1,
    would_update: 2,
    applied: 0,
  })
})

test('dry-run backfill check scans without database updates', async () => {
  const { supabase, operations } = createBackfillSupabaseMock([
    {
      ...makeRow({ id: 'missing', budget_behavior: null }),
      categories: [
        {
          type: 'income',
          is_excluded_from_budget: false,
        },
      ],
    },
  ])

  const summary = await runSemanticsBackfillCheck(supabase, {
    apply: false,
    limit: 10,
  })

  assert.deepEqual(summary, {
    scanned: 1,
    missing_budget_behavior: 1,
    system_mismatches: 0,
    would_update: 1,
    applied: 0,
  })
  assert.equal(
    operations.some((operation) => operation.action === 'update'),
    false
  )
})

test('apply mode updates only rows needing system-derived behavior', async () => {
  const { supabase, operations } = createBackfillSupabaseMock([
    {
      ...makeRow({
        id: 'missing',
        budget_behavior: null,
        semantic_override_source: null,
      }),
      categories: {
        type: 'income',
        is_excluded_from_budget: false,
      },
    },
    {
      ...makeRow({
        id: 'wrong',
        budget_behavior: 'count_as_spending',
      }),
      categories: {
        type: 'transfer',
        is_excluded_from_budget: false,
      },
    },
  ])

  const summary = await runSemanticsBackfillCheck(supabase, {
    apply: true,
    userId: 'user_1',
    limit: 10,
  })
  const updates = operations.filter((operation) => operation.action === 'update')

  assert.deepEqual(summary, {
    scanned: 2,
    missing_budget_behavior: 1,
    system_mismatches: 1,
    would_update: 2,
    applied: 2,
  })
  assert.deepEqual(updates.map((operation) => operation.payload), [
    {
      budget_behavior: 'count_as_income',
      semantic_override_source: 'system',
    },
    {
      budget_behavior: 'exclude_as_transfer',
      semantic_override_source: 'system',
    },
  ])
  assert.deepEqual(updates[0].filters, [
    { column: 'id', value: 'missing' },
    { column: 'user_id', value: 'user_1' },
  ])
})
