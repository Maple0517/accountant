import test from 'node:test'
import assert from 'node:assert/strict'

import { adaptCategories, adaptTransactions } from '@/modules/budget/budget.adapter'
import type { Category, Transaction } from '@/types'

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

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx_1',
    user_id: 'user_1',
    account_id: 'account_1',
    amount: 100,
    date: '2026-02-05',
    description: 'Transaction',
    pending: false,
    source: 'plaid',
    created_at: '2026-02-05T00:00:00Z',
    updated_at: '2026-02-05T00:00:00Z',
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

test('transaction adapter preserves Plaid amount signs for refunds', () => {
  const category = makeCategory({ id: 'cat_food' })
  const [purchase, refund] = adaptTransactions(
    [
      makeTransaction({ id: 'purchase', amount: 100, category_id: 'cat_food' }),
      makeTransaction({ id: 'refund', amount: -30, category_id: 'cat_food' }),
    ],
    new Map([[category.id, category]])
  )

  assert.equal(purchase.amount, 100)
  assert.equal(refund.amount, -30)
})

test('transaction adapter uses budget_effective_date when present', () => {
  const category = makeCategory({ id: 'cat_food' })
  const [refund] = adaptTransactions(
    [
      makeTransaction({
        id: 'refund',
        amount: -100,
        category_id: 'cat_food',
        date: '2026-02-05',
        budget_effective_date: '2026-01-20',
      }),
    ],
    new Map([[category.id, category]])
  )

  assert.equal(refund.date, '2026-01-20')
})
