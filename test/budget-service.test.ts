import test from 'node:test'
import assert from 'node:assert/strict'

import { getMonthlySummary, updateCategoryBudget } from '@/modules/budget/budget.service'

function createSupabaseStub(categories: Array<Record<string, unknown>> = []) {
  return {
    from(table: string) {
      const chain = {
        select() {
          return chain
        },
        eq(column: string, value: unknown) {
          void value
          if (table === 'categories' && column === 'user_id') {
            return {
              order() {
                return Promise.resolve({ data: categories, error: null })
              },
            }
          }

          if (table === 'profiles' && column === 'id') {
            return {
              single() {
                return Promise.resolve({ data: null, error: null })
              },
            }
          }

          return chain
        },
        gte() {
          return chain
        },
        lt() {
          return Promise.resolve({ data: [], error: null })
        },
        order() {
          return Promise.resolve({ data: categories, error: null })
        },
        single() {
          return Promise.resolve({ data: null, error: null })
        },
        upsert(payload: unknown) {
          return Promise.resolve({ data: payload, error: null })
        },
      }

      return chain
    },
  }
}

test('getMonthlySummary rejects invalid month values beyond simple regex shape', async () => {
  const supabase = createSupabaseStub()

  await assert.rejects(
    () => getMonthlySummary(supabase as never, 'user_1', '2026-13'),
    /Invalid month format: expected YYYY-MM/
  )

  await assert.rejects(
    () => getMonthlySummary(supabase as never, 'user_1', '2026-00'),
    /Invalid month format: expected YYYY-MM/
  )
})

test('updateCategoryBudget rejects negative amount', async () => {
  const supabase = createSupabaseStub([
    { id: 'cat_food', user_id: 'user_1', name: 'Food', type: 'expense', sort_order: 0 },
  ])

  await assert.rejects(
    () => updateCategoryBudget(supabase as never, 'user_1', 'cat_food', '2026-05', -1),
    /Amount must be non-negative/
  )
})

test('updateCategoryBudget rejects invalid month values', async () => {
  const supabase = createSupabaseStub([
    { id: 'cat_food', user_id: 'user_1', name: 'Food', type: 'expense', sort_order: 0 },
  ])

  await assert.rejects(
    () => updateCategoryBudget(supabase as never, 'user_1', 'cat_food', '2026-13', 50),
    /Invalid month format: expected YYYY-MM/
  )
})

test('updateCategoryBudget rejects unknown category for current user', async () => {
  const supabase = createSupabaseStub([
    { id: 'cat_rent', user_id: 'user_1', name: 'Rent', type: 'expense', sort_order: 0 },
  ])

  await assert.rejects(
    () => updateCategoryBudget(supabase as never, 'user_1', 'cat_food', '2026-05', 50),
    /Category not found for user/
  )
})

test('updateCategoryBudget accepts valid category owned by current user', async () => {
  let capturedPayload: unknown = null

  const supabase = {
    from(table: string) {
      const chain = {
        select() {
          return chain
        },
        eq(column: string, value: unknown) {
          if (table === 'categories' && column === 'user_id' && value === 'user_1') {
            return {
              order() {
                return Promise.resolve({
                  data: [
                    { id: 'cat_food', user_id: 'user_1', name: 'Food', type: 'expense', sort_order: 0 },
                  ],
                  error: null,
                })
              },
            }
          }

          return chain
        },
        upsert(payload: unknown) {
          capturedPayload = payload
          return Promise.resolve({ data: payload, error: null })
        },
      }

      return chain
    },
  }

  await updateCategoryBudget(supabase as never, 'user_1', 'cat_food', '2026-05', 125)

  assert.deepEqual(capturedPayload, {
    user_id: 'user_1',
    category_id: 'cat_food',
    month: 5,
    year: 2026,
    amount: 125,
    period: 'monthly',
  })
})

test('getMonthlySummary budgets linked refunded-category rows against original category', async () => {
  const categories = [
    {
      id: 'cat_shopping',
      user_id: 'user_1',
      name: 'Shopping',
      type: 'expense',
      sort_order: 0,
      is_excluded_from_budget: false,
    },
    {
      id: 'cat_refunded',
      user_id: 'user_1',
      name: 'Refunded',
      name_zh: '已退款',
      type: 'expense',
      sort_order: 1,
      is_excluded_from_budget: false,
    },
  ]
  const monthlyTransactions = [
    {
      id: 'purchase',
      user_id: 'user_1',
      account_id: 'account_1',
      category_id: 'cat_shopping',
      amount: 100,
      date: '2026-01-20',
      budget_effective_date: '2026-01-20',
      description: 'Amazon purchase',
      pending: false,
      source: 'plaid',
      transaction_kind: 'normal',
      linked_transaction_id: null,
    },
    {
      id: 'refund',
      user_id: 'user_1',
      account_id: 'account_1',
      category_id: 'cat_refunded',
      amount: -100,
      date: '2026-02-05',
      budget_effective_date: '2026-01-20',
      description: 'Amazon refund',
      pending: false,
      source: 'plaid',
      transaction_kind: 'refund',
      linked_transaction_id: 'purchase',
    },
  ]
  const supabase = {
    from(table: string) {
      const chain = {
        select() {
          return chain
        },
        eq(column: string, value: unknown) {
          void value
          if (table === 'categories' && column === 'user_id') {
            return {
              order() {
                return Promise.resolve({ data: categories, error: null })
              },
            }
          }

          if (table === 'profiles' && column === 'id') {
            return {
              single() {
                return Promise.resolve({ data: null, error: null })
              },
            }
          }

          return chain
        },
        or() {
          return Promise.resolve({ data: monthlyTransactions, error: null })
        },
        in(column: string, ids: string[]) {
          assert.equal(table, 'transactions')
          assert.equal(column, 'id')
          assert.deepEqual(ids, ['purchase'])
          return Promise.resolve({
            data: [{ id: 'purchase', category_id: 'cat_shopping' }],
            error: null,
          })
        },
        order() {
          return Promise.resolve({ data: categories, error: null })
        },
        single() {
          return Promise.resolve({ data: null, error: null })
        },
      }

      return chain
    },
  }

  const summary = await getMonthlySummary(supabase as never, 'user_1', '2026-01')
  const shopping = summary.categories.find((category) => category.categoryId === 'cat_shopping')
  const refunded = summary.categories.find((category) => category.categoryId === 'cat_refunded')

  assert.equal(shopping?.actualSpend, 0)
  assert.equal(refunded?.actualSpend, 0)
})
