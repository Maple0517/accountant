import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getAnalyticsSummary,
  parseAnalyticsPeriod,
} from '@/modules/analytics/analytics.service'

test('parseAnalyticsPeriod falls back to month for unknown values', () => {
  assert.equal(parseAnalyticsPeriod('week'), 'week')
  assert.equal(parseAnalyticsPeriod('year'), 'year')
  assert.equal(parseAnalyticsPeriod('bogus'), 'month')
  assert.equal(parseAnalyticsPeriod(null), 'month')
})

test('getAnalyticsSummary uses budget semantics for spending, income, and budget dates', async () => {
  const rows = [
    {
      amount: 25,
      date: '2026-05-01',
      budget_behavior: 'count_as_spending',
      budget_effective_date: null,
      transaction_kind: 'normal',
      category_id: 'food',
      categories: { name: 'Food', name_zh: '餐饮美食', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: -100,
      date: '2026-05-02',
      budget_behavior: 'count_as_income',
      budget_effective_date: null,
      transaction_kind: 'normal',
      category_id: 'income',
      categories: { name: 'Income', icon: '💰', color: '#4caf50' },
    },
    {
      amount: 10,
      date: '2026-05-02',
      budget_behavior: 'exclude_as_transfer',
      budget_effective_date: null,
      transaction_kind: 'transfer',
      category_id: 'transfer',
      categories: { name: 'Transfer', icon: '🔁', color: '#9e9e9e' },
    },
    {
      amount: -8,
      date: '2026-06-02',
      budget_behavior: 'count_as_spending',
      budget_effective_date: '2026-05-02',
      transaction_kind: 'refund',
      category_id: 'food',
      categories: { name: 'Food', name_zh: '餐饮美食', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: 5,
      date: '2026-05-03',
      budget_behavior: 'count_as_spending',
      budget_effective_date: null,
      transaction_kind: 'normal',
      category_id: 'subscription',
      categories: { name: '订阅', icon: '💻', color: '#ef5350' },
    },
  ]
  const supabase = {
    from(table: string) {
      assert.equal(table, 'transactions')
      const chain = {
        select() {
          return chain
        },
        eq(column: string, value: unknown) {
          if (column === 'user_id') {
            assert.equal(value, 'user_1')
          }
          return chain
        },
        neq() {
          return chain
        },
        is() {
          return chain
        },
        gte() {
          return chain
        },
        order() {
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return chain
    },
  }

  const summary = await getAnalyticsSummary(supabase as never, 'user_1', 'month')

  assert.equal(summary.totalSpending, 22)
  assert.equal(summary.totalIncome, 100)
  assert.equal(summary.categorySpendingTotal, 22)
  assert.deepEqual(summary.byCategory, [
    { name: 'Food & Drink', name_zh: '餐饮美食', icon: '🍔', color: '#ff9800', total: 17 },
    { name: 'Subscriptions', name_zh: '订阅', icon: '💻', color: '#ef5350', total: 5 },
  ])
  assert.deepEqual(summary.byDay, [
    { date: '2026-05-01', total: 25 },
    { date: '2026-05-02', total: -8 },
    { date: '2026-05-03', total: 5 },
  ])
})

test('getAnalyticsSummary ignores excluded budget categories even with stale spending behavior', async () => {
  const rows = [
    {
      amount: 25,
      iso_currency_code: 'USD',
      date: '2026-05-01',
      budget_behavior: 'count_as_spending',
      category_id: 'food',
      categories: {
        name: 'Food',
        icon: '🍔',
        color: '#ff9800',
        is_excluded_from_budget: false,
      },
    },
    {
      amount: 3126,
      iso_currency_code: 'USD',
      date: '2026-05-02',
      budget_behavior: 'count_as_spending',
      category_id: 'excluded',
      categories: {
        name: 'Excluded',
        icon: '🚫',
        color: '#9e9e9e',
        is_excluded_from_budget: true,
      },
    },
  ]
  const supabase = {
    from() {
      const chain = {
        select() {
          return chain
        },
        eq() {
          return chain
        },
        neq() {
          return chain
        },
        is() {
          return chain
        },
        gte() {
          return chain
        },
        order() {
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return chain
    },
  }

  const summary = await getAnalyticsSummary(supabase as never, 'user_1', 'month', 'USD')

  assert.equal(summary.totalSpending, 25)
  assert.equal(summary.categorySpendingTotal, 25)
  assert.deepEqual(summary.byCategory, [
    { name: 'Food', name_zh: null, icon: '🍔', color: '#ff9800', total: 25 },
  ])
  assert.deepEqual(summary.byDay, [{ date: '2026-05-01', total: 25 }])
})


test('getAnalyticsSummary filters by selected currency and defaults null currencies to USD', async () => {
  const rows = [
    {
      amount: 25,
      iso_currency_code: 'USD',
      date: '2026-05-01',
      budget_behavior: 'count_as_spending',
      budget_effective_date: null,
      transaction_kind: 'normal',
      category_id: 'food',
      categories: { name: 'Food', name_zh: '餐饮美食', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: 30,
      iso_currency_code: 'CNY',
      date: '2026-05-01',
      budget_behavior: 'count_as_spending',
      budget_effective_date: null,
      transaction_kind: 'normal',
      category_id: 'food',
      categories: { name: 'Food', name_zh: '餐饮美食', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: -40,
      iso_currency_code: null,
      date: '2026-05-02',
      budget_behavior: 'count_as_income',
      budget_effective_date: null,
      transaction_kind: 'normal',
      category_id: 'income',
      categories: { name: 'Income', icon: '💰', color: '#4caf50' },
    },
  ]
  const supabase = {
    from() {
      const chain = {
        select() {
          return chain
        },
        eq() {
          return chain
        },
        neq() {
          return chain
        },
        is() {
          return chain
        },
        gte() {
          return chain
        },
        order() {
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return chain
    },
  }

  const usdSummary = await getAnalyticsSummary(supabase as never, 'user_1', 'month', 'USD')
  assert.equal(usdSummary.currencyCode, 'USD')
  assert.equal(usdSummary.totalSpending, 25)
  assert.equal(usdSummary.totalIncome, 40)
  assert.deepEqual(usdSummary.availableCurrencies, ['USD', 'CNY'])

  const cnySummary = await getAnalyticsSummary(supabase as never, 'user_1', 'month', 'CNY')
  assert.equal(cnySummary.currencyCode, 'CNY')
  assert.equal(cnySummary.totalSpending, 30)
  assert.equal(cnySummary.totalIncome, 0)
})

test('getAnalyticsSummary reports positive category total for spending share denominator', async () => {
  const rows = [
    {
      amount: 100,
      iso_currency_code: 'USD',
      date: '2026-05-01',
      budget_behavior: 'count_as_spending',
      budget_effective_date: null,
      transaction_kind: 'normal',
      category_id: 'food',
      categories: { name: 'Food', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: -90,
      iso_currency_code: 'USD',
      date: '2026-05-02',
      budget_behavior: 'count_as_spending',
      budget_effective_date: null,
      transaction_kind: 'refund',
      category_id: 'shopping',
      categories: { name: 'Shopping', icon: '🛍️', color: '#e91e63' },
    },
  ]
  const supabase = {
    from() {
      const chain = {
        select() {
          return chain
        },
        eq() {
          return chain
        },
        neq() {
          return chain
        },
        is() {
          return chain
        },
        gte() {
          return chain
        },
        order() {
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return chain
    },
  }

  const summary = await getAnalyticsSummary(supabase as never, 'user_1', 'month', 'USD')

  assert.equal(summary.totalSpending, 10)
  assert.equal(summary.categorySpendingTotal, 100)
  assert.deepEqual(summary.byCategory, [
    { name: 'Food', name_zh: null, icon: '🍔', color: '#ff9800', total: 100 },
    { name: 'Shopping', name_zh: '购物消费', icon: '🛍️', color: '#e91e63', total: -90 },
  ])
})
