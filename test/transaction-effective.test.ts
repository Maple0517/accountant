import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getBudgetDate,
  getBudgetSemanticAmounts,
  getEffectiveTransactions,
  getTransactionSemanticAmounts,
  isEffectiveTransaction,
} from '@/lib/transactions/effective'

test('effective transaction visibility excludes deleted hidden and split parent rows', () => {
  assert.equal(isEffectiveTransaction({ amount: 10, date: '2026-05-01' }), true)
  assert.equal(
    isEffectiveTransaction({
      amount: 10,
      date: '2026-05-01',
      deleted_at: '2026-05-02T00:00:00Z',
    }),
    false
  )
  assert.equal(
    isEffectiveTransaction({
      amount: 10,
      date: '2026-05-01',
      is_hidden_from_reports: true,
    }),
    false
  )
  assert.equal(
    isEffectiveTransaction({
      amount: 10,
      date: '2026-05-01',
      split_role: 'parent',
    }),
    false
  )
  assert.equal(
    isEffectiveTransaction({
      amount: 10,
      date: '2026-05-01',
      split_role: 'child',
    }),
    true
  )
})

test('getBudgetDate prefers generated effective_date then budget_effective_date', () => {
  assert.equal(
    getBudgetDate({
      date: '2026-05-01',
      budget_effective_date: '2026-06-01',
      effective_date: '2026-07-01',
    }),
    '2026-07-01'
  )
  assert.equal(
    getBudgetDate({
      date: '2026-05-01',
      budget_effective_date: '2026-06-01',
    }),
    '2026-06-01'
  )
  assert.equal(getBudgetDate({ date: '2026-05-01' }), '2026-05-01')
})

test('getEffectiveTransactions keeps normal rows and active split children only', () => {
  const rows = [
    { id: 'normal', amount: 12, date: '2026-05-01' },
    { id: 'parent', amount: 12, date: '2026-05-01', split_role: 'parent' },
    { id: 'child', amount: 8, date: '2026-05-01', split_role: 'child' },
    { id: 'deleted', amount: 4, date: '2026-05-01', deleted_at: 'now' },
  ]

  assert.deepEqual(
    getEffectiveTransactions(rows).map((row) => row.id),
    ['normal', 'child']
  )
})

test('semantic amounts follow Accountant signed amount conventions', () => {
  assert.deepEqual(getTransactionSemanticAmounts({ amount: 25 }), {
    netSpending: 25,
    income: 0,
    categoryNetSpend: 25,
  })
  assert.deepEqual(getTransactionSemanticAmounts({ amount: -40 }), {
    netSpending: 0,
    income: 40,
    categoryNetSpend: 0,
  })
  assert.deepEqual(
    getTransactionSemanticAmounts({
      amount: -8,
      treatment: 'refund',
      refund_source: 'merchant_refund',
    }),
    { netSpending: -8, income: 0, categoryNetSpend: -8 }
  )
  assert.deepEqual(
    getTransactionSemanticAmounts({
      amount: -40,
      treatment: 'income',
    }),
    { netSpending: 0, income: 40, categoryNetSpend: 0 }
  )
  assert.deepEqual(
    getTransactionSemanticAmounts({
      amount: 25,
      treatment: 'transfer',
    }),
    { netSpending: 0, income: 0, categoryNetSpend: 0 }
  )
})

test('budget semantic amounts honor category-level budget exclusion', () => {
  assert.deepEqual(
    getBudgetSemanticAmounts({
      amount: 3126,
      treatment: 'spending',
      category_is_excluded_from_budget: true,
    }),
    { netSpending: 0, income: 0, categoryNetSpend: 0 }
  )
})

test('pending transactions have no budget semantic amounts until posted', () => {
  assert.deepEqual(
    getBudgetSemanticAmounts({
      amount: 4326,
      treatment: 'spending',
      pending: true,
    }),
    { netSpending: 0, income: 0, categoryNetSpend: 0 }
  )
})
