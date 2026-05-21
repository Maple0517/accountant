import test from 'node:test'
import assert from 'node:assert/strict'

import { adaptCategories } from '@/modules/budget/budget.adapter'
import type { Category } from '@/types'

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat_1',
    user_id: 'user_1',
    name: 'Food',
    type: 'expense',
    sort_order: 0,
    created_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

test('adapter keeps ordinary expense categories in budget', () => {
  const [category] = adaptCategories([
    makeCategory({ is_excluded_from_budget: false }),
  ])

  assert.equal(category.isExcludedFromBudget, false)
})

test('adapter excludes category marked is_excluded_from_budget', () => {
  const [category] = adaptCategories([
    makeCategory({
      id: 'cat_excluded',
      name: 'Excluded',
      name_zh: '不计入',
      type: 'expense',
      is_excluded_from_budget: true,
    }),
  ])

  assert.equal(category.isExcludedFromBudget, true)
})

test('adapter excludes income and transfer categories', () => {
  const [income, transfer] = adaptCategories([
    makeCategory({
      id: 'cat_income',
      name: 'Income',
      type: 'income',
      is_excluded_from_budget: false,
    }),
    makeCategory({
      id: 'cat_transfer',
      name: 'Transfer',
      type: 'transfer',
      is_excluded_from_budget: false,
    }),
  ])

  assert.equal(income.isExcludedFromBudget, true)
  assert.equal(transfer.isExcludedFromBudget, true)
})
