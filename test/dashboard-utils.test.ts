import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getDashboardStatusSummary,
  getLargestSpendingDriver,
  getPostedMoneyDrivers,
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
        category_id: null,
        treatment: 'spending',
        refund_source: null,
        tags: ['classification:ai-pending'],
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

test('dashboard largest spending driver uses posted budget-effective spending in selected currency', () => {
  const driver = getLargestSpendingDriver([
    {
      id: 'rent',
      amount: 4326,
      date: '2026-06-02',
      iso_currency_code: 'USD',
      treatment: 'spending',
      merchant_name: 'Bilt Housing',
      pending: false,
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
    pending: false,
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

test('dashboard monthly amounts and drivers exclude pending transactions until posted', () => {
  assert.deepEqual(
    getMonthlySemanticAmounts({
      amount: 4326,
      treatment: 'spending',
      pending: true,
      categories: { is_excluded_from_budget: false },
    }),
    { spending: 0, income: 0 }
  )

  const driver = getLargestSpendingDriver([
    {
      id: 'pending_rent',
      amount: 4326,
      date: '2026-06-02',
      iso_currency_code: 'USD',
      treatment: 'spending',
      merchant_name: 'Bilt Housing',
      pending: true,
      categories: { is_excluded_from_budget: false },
    },
    {
      id: 'posted_bill',
      amount: 623.21,
      date: '2026-06-01',
      iso_currency_code: 'USD',
      treatment: 'spending',
      merchant_name: 'Puget Sound Energy',
      pending: false,
      categories: { is_excluded_from_budget: false },
    },
  ], 'USD')

  assert.equal(driver?.id, 'posted_bill')
  assert.equal(driver?.amount, 623.21)
})

test('dashboard money drivers list excludes pending rows from ranked drivers', () => {
  const drivers = getPostedMoneyDrivers([
    {
      id: 'pending_rent',
      amount: 4326,
      date: '2026-06-02',
      source: 'plaid',
      pending: true,
    },
    {
      id: 'posted_shop',
      amount: 10.02,
      date: '2026-06-01',
      source: 'plaid',
      pending: false,
    },
  ])

  assert.deepEqual(drivers.map((driver) => driver.id), ['posted_shop'])
})
