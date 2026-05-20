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
