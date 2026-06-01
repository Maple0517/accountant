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

test('adapter normalizes default category names for localized stored rows', () => {
  const [category] = adaptCategories([
    makeCategory({ name: '订阅' }),
  ])

  assert.equal(category.name, 'Subscriptions')
  assert.equal(category.nameZh, '订阅')
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

test('transaction adapter prefers generated effective_date when present', () => {
  const category = makeCategory({ id: 'cat_food' })
  const [splitChild] = adaptTransactions(
    [
      makeTransaction({
        id: 'split_child',
        amount: 50,
        category_id: 'cat_food',
        date: '2026-05-20',
        budget_effective_date: '2026-06-01',
        effective_date: '2026-06-01',
        split_role: 'child',
      }),
    ],
    new Map([[category.id, category]])
  )

  assert.equal(splitChild.date, '2026-06-01')
})

test('transaction adapter maps hidden and deleted flags into engine input', () => {
  const category = makeCategory({ id: 'cat_food' })
  const [hidden, deleted] = adaptTransactions(
    [
      makeTransaction({
        id: 'hidden',
        category_id: 'cat_food',
        is_hidden_from_reports: true,
      }),
      makeTransaction({
        id: 'deleted',
        category_id: 'cat_food',
        deleted_at: '2026-05-02T00:00:00Z',
      }),
    ],
    new Map([[category.id, category]])
  )

  assert.equal(hidden.isHidden, true)
  assert.equal(hidden.isDeleted, false)
  assert.equal(deleted.isHidden, false)
  assert.equal(deleted.isDeleted, true)
})

test('transaction adapter uses original category for linked refund budget math', () => {
  const shopping = makeCategory({ id: 'cat_shopping', name: 'Shopping' })
  const refunded = makeCategory({ id: 'cat_refunded', name: 'Refunded', name_zh: '已退款' })
  const [refund] = adaptTransactions(
    [
      makeTransaction({
        id: 'refund',
        amount: -100,
        category_id: 'cat_refunded',
        treatment: 'refund',
        refund_source: 'merchant_refund',
        linked_transaction_id: 'purchase',
      }),
    ],
    new Map([
      [shopping.id, shopping],
      [refunded.id, refunded],
    ]),
    new Map([['refund', 'cat_shopping']])
  )

  assert.equal(refund.categoryId, 'cat_shopping')
  assert.equal(refund.amount, -100)
  assert.equal(refund.treatment, 'refund')
  assert.equal(refund.refundSource, 'merchant_refund')
})

test('transaction adapter preserves canonical transfer treatment', () => {
  const transfer = makeCategory({
    id: 'cat_transfer',
    name: 'Transfer',
    type: 'transfer',
    is_excluded_from_budget: false,
  })
  const [payment] = adaptTransactions(
    [
      makeTransaction({
        id: 'payment',
        amount: 250,
        category_id: 'cat_transfer',
        treatment: 'transfer',
      }),
    ],
    new Map([[transfer.id, transfer]])
  )

  assert.equal(payment.type, 'transfer')
  assert.equal(payment.treatment, 'transfer')
  assert.equal(payment.refundSource, null)
})
