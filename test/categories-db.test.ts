import test from 'node:test'
import assert from 'node:assert/strict'

import { getOrCreateRefundedCategory } from '@/lib/categories-db'

test('getOrCreateRefundedCategory reuses existing Chinese category', async () => {
  const existing = {
    id: 'cat_refunded',
    user_id: 'user_1',
    name: 'Something Else',
    name_zh: '已退款',
    icon: null,
    color: null,
    type: 'expense' as const,
    sort_order: 10,
  }
  const supabase = {
    from() {
      throw new Error('database should not be called when category is cached')
    },
  }

  const category = await getOrCreateRefundedCategory(
    supabase as never,
    'user_1',
    [existing]
  )

  assert.equal(category?.id, 'cat_refunded')
})

test('getOrCreateRefundedCategory creates missing category and updates cache', async () => {
  const categories = [
    {
      id: 'cat_food',
      user_id: 'user_1',
      name: 'Food',
      name_zh: '餐饮美食',
      icon: null,
      color: null,
      type: 'expense' as const,
      sort_order: 3,
    },
  ]
  const insertedPayloads: Record<string, unknown>[] = []
  const inserted = {
    id: 'cat_refunded',
    user_id: 'user_1',
    name: 'Refunded',
    name_zh: '已退款',
    icon: '↩️',
    color: '#14b8a6',
    type: 'expense' as const,
    sort_order: 4,
    is_excluded_from_budget: false,
  }
  const supabase = {
    from(table: string) {
      assert.equal(table, 'categories')
      return {
        insert(payload: Record<string, unknown>) {
          insertedPayloads.push(payload)
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({ data: inserted, error: null })
                },
              }
            },
          }
        },
      }
    },
  }

  const category = await getOrCreateRefundedCategory(
    supabase as never,
    'user_1',
    categories
  )

  assert.equal(category?.id, 'cat_refunded')
  assert.equal(insertedPayloads[0].name, 'Refunded')
  assert.equal(insertedPayloads[0].name_zh, '已退款')
  assert.equal(insertedPayloads[0].sort_order, 4)
  assert.equal(categories.at(-1)?.id, 'cat_refunded')
})
