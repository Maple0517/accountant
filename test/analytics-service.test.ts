import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getAnalyticsPeriodWindow,
  getAnalyticsSummary,
  parseAnalyticsPeriod,
} from '@/modules/analytics/analytics.service'


function makeAnalyticsSupabase(rows: unknown[]) {
  return {
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
        lt() {
          return chain
        },
        order() {
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return chain
    },
  }
}

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
      treatment: 'spending',
      budget_effective_date: null,
      category_id: 'food',
      categories: { name: 'Food', name_zh: '餐饮美食', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: -100,
      date: '2026-05-02',
      treatment: 'income',
      budget_effective_date: null,
      category_id: 'income',
      categories: { name: 'Income', icon: '💰', color: '#4caf50' },
    },
    {
      amount: 10,
      date: '2026-05-02',
      treatment: 'transfer',
      budget_effective_date: null,
      category_id: 'transfer',
      categories: { name: 'Transfer', icon: '🔁', color: '#9e9e9e' },
    },
    {
      amount: -8,
      date: '2026-06-02',
      treatment: 'refund',
      refund_source: 'merchant_refund',
      budget_effective_date: '2026-05-02',
      category_id: 'food',
      categories: { name: 'Food', name_zh: '餐饮美食', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: 5,
      date: '2026-05-03',
      treatment: 'spending',
      budget_effective_date: null,
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
        lt() {
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
      treatment: 'spending',
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
      treatment: 'spending',
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
        lt() {
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



test('getAnalyticsSummary excludes pending transactions from report totals until posted', async () => {
  const rows = [
    {
      amount: 4326,
      iso_currency_code: 'USD',
      date: '2026-06-02',
      pending: true,
      treatment: 'spending',
      category_id: 'housing',
      categories: { name: 'Housing', icon: '🏠', color: '#795548' },
    },
    {
      amount: 13.71,
      iso_currency_code: 'USD',
      date: '2026-06-01',
      pending: false,
      treatment: 'spending',
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
        lt() {
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

  assert.equal(summary.totalSpending, 13.71)
  assert.deepEqual(summary.byCategory, [
    { name: 'Shopping', name_zh: '购物消费', icon: '🛍️', color: '#e91e63', total: 13.71 },
  ])
  assert.deepEqual(summary.byDay, [{ date: '2026-06-01', total: 13.71 }])
})

test('getAnalyticsSummary filters by selected currency and defaults null currencies to USD', async () => {
  const rows = [
    {
      amount: 25,
      iso_currency_code: 'USD',
      date: '2026-05-01',
      treatment: 'spending',
      budget_effective_date: null,
      category_id: 'food',
      categories: { name: 'Food', name_zh: '餐饮美食', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: 30,
      iso_currency_code: 'CNY',
      date: '2026-05-01',
      treatment: 'spending',
      budget_effective_date: null,
      category_id: 'food',
      categories: { name: 'Food', name_zh: '餐饮美食', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: -40,
      iso_currency_code: null,
      date: '2026-05-02',
      treatment: 'income',
      budget_effective_date: null,
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
        lt() {
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
      treatment: 'spending',
      budget_effective_date: null,
      category_id: 'food',
      categories: { name: 'Food', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: -90,
      iso_currency_code: 'USD',
      date: '2026-05-02',
      treatment: 'refund',
      refund_source: 'merchant_refund',
      budget_effective_date: null,
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
        lt() {
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


test('getAnalyticsPeriodWindow builds month-to-date comparison windows', () => {
  const window = getAnalyticsPeriodWindow('month', new Date('2026-06-15T12:00:00'))

  assert.deepEqual(window, {
    period: 'month',
    startDate: '2026-06-01',
    endDate: '2026-06-16',
    comparisonStartDate: '2026-05-01',
    comparisonEndDate: '2026-05-16',
  })
})

test('getAnalyticsSummary includes period-over-period totals', async () => {
  const rows = [
    {
      amount: 100,
      iso_currency_code: 'USD',
      effective_date: '2026-06-04',
      date: '2026-06-04',
      treatment: 'spending',
      category_id: 'food',
      merchant_name: 'Whole Foods',
      categories: { name: 'Food', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: 70,
      iso_currency_code: 'USD',
      effective_date: '2026-05-04',
      date: '2026-05-04',
      treatment: 'spending',
      category_id: 'food',
      merchant_name: 'Whole Foods',
      categories: { name: 'Food', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: -200,
      iso_currency_code: 'USD',
      effective_date: '2026-06-05',
      date: '2026-06-05',
      treatment: 'income',
      category_id: 'income',
      merchant_name: 'Payroll',
      categories: { name: 'Income', icon: '💰', color: '#4caf50' },
    },
  ]
  const supabase = makeAnalyticsSupabase(rows)

  const summary = await getAnalyticsSummary(supabase as never, 'user_1', 'month', 'USD', {
    now: new Date('2026-06-15T12:00:00'),
  })

  assert.equal(summary.totalSpending, 100)
  assert.equal(summary.totalIncome, 200)
  assert.deepEqual(summary.totals, {
    spending: 100,
    income: 200,
    net: 100,
    previousSpending: 70,
    previousIncome: 0,
    previousNet: -70,
    spendingDelta: 30,
    incomeDelta: 200,
    netDelta: 170,
  })
  assert.equal(summary.changeDrivers.categories[0].delta, 30)
})
