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

test('getAnalyticsSummary treats positive amounts as spending and negative amounts as income', async () => {
  const rows = [
    {
      amount: 25,
      date: '2026-05-01',
      categories: { name: 'Food', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: -100,
      date: '2026-05-02',
      categories: { name: 'Income', icon: '💰', color: '#4caf50' },
    },
    {
      amount: 10,
      date: '2026-05-02',
      categories: { name: 'Food', icon: '🍔', color: '#ff9800' },
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
          assert.equal(column, 'user_id')
          assert.equal(value, 'user_1')
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

  assert.equal(summary.totalSpending, 35)
  assert.equal(summary.totalIncome, 100)
  assert.deepEqual(summary.byCategory, [
    { name: 'Food', icon: '🍔', color: '#ff9800', total: 35 },
  ])
  assert.deepEqual(summary.byDay, [
    { date: '2026-05-01', total: 25 },
    { date: '2026-05-02', total: 10 },
  ])
})
