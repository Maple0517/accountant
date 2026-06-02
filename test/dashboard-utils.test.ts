import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getDashboardStatusSummary,
  getLargestSpendingDriver,
  getMonthlySemanticAmounts,
  getReviewCounts,
} from '@/features/dashboard/dashboard-utils'

test('dashboard monthly totals ignore excluded budget categories', () => {
  assert.deepEqual(
    getMonthlySemanticAmounts({
      amount: 3126,
      treatment: 'spending',
      categories: { is_excluded_from_budget: true },
    }),
    { spending: 0, income: 0 }
  )
})

test('dashboard review counts ignore pending-only and linked refunds', () => {
  assert.deepEqual(
    getReviewCounts([
      {
        amount: 25,
        date: '2026-05-01',
        pending: true,
        category_id: 'cat_1',
        treatment: 'spending',
        refund_source: null,
        tags: [],
      },
      {
        amount: -8,
        date: '2026-05-02',
        pending: false,
        category_id: 'cat_refunded',
        treatment: 'refund',
        refund_source: 'merchant_refund',
        linked_transaction_id: 'purchase_1',
        refund_match_confidence: 0.2,
        tags: [],
      },
    ]),
    {
      aiPending: 0,
      uncategorized: 0,
      possibleRefunds: 0,
      unmatchedTransfers: 0,
    }
  )
})

test('dashboard largest spending driver uses budget-effective spending in selected currency', () => {
  const driver = getLargestSpendingDriver([
    {
      id: 'rent',
      amount: 4326,
      date: '2026-06-02',
      iso_currency_code: 'USD',
      treatment: 'spending',
      merchant_name: 'Bilt Housing',
      pending: true,
      categories: { is_excluded_from_budget: false },
    },
    {
      id: 'ignored_currency',
      amount: 9000,
      date: '2026-06-02',
      iso_currency_code: 'CNY',
      treatment: 'spending',
      merchant_name: 'Foreign charge',
      categories: { is_excluded_from_budget: false },
    },
    {
      id: 'excluded',
      amount: 7000,
      date: '2026-06-02',
      iso_currency_code: 'USD',
      treatment: 'spending',
      merchant_name: 'Excluded transfer',
      categories: { is_excluded_from_budget: true },
    },
  ], 'USD')

  assert.deepEqual(driver, {
    id: 'rent',
    label: 'Bilt Housing',
    amount: 4326,
    date: '2026-06-02',
    pending: true,
    currencyCode: 'USD',
  })
})

test('dashboard status summary highlights safe budget with dominant spending driver', () => {
  assert.equal(
    getDashboardStatusSummary({
      budgetLeft: 4036.29,
      budgetPercent: 0.003,
      reviewTotal: 0,
      monthlySpending: 5455.62,
      largestDriverLabel: 'Bilt Housing',
    }),
    'Budget is safe, but Bilt Housing is driving this month\'s spend.'
  )
})
