import test from 'node:test'
import assert from 'node:assert/strict'

import { filterByCurrency, isSameCurrency, normalizeCurrencyCode } from '@/lib/money/currency'
import { formatCurrencyTotals, hasMultipleCurrencies, sumByCurrency } from '@/lib/money/totals'

test('normalizeCurrencyCode defaults to USD and uppercases input', () => {
  assert.equal(normalizeCurrencyCode(undefined), 'USD')
  assert.equal(normalizeCurrencyCode(null), 'USD')
  assert.equal(normalizeCurrencyCode(''), 'USD')
  assert.equal(normalizeCurrencyCode('cny'), 'CNY')
  assert.equal(isSameCurrency(null, 'usd'), true)
})

test('filterByCurrency and sumByCurrency keep mixed currencies separate', () => {
  const rows = [
    { amount: 10, currency: 'usd' },
    { amount: 20, currency: 'CNY' },
    { amount: 5, currency: null },
  ]

  const filtered = filterByCurrency(rows, 'USD', (row) => row.currency)
  assert.deepEqual(filtered, [rows[0], rows[2]])

  const totals = sumByCurrency(rows, (row) => row.amount, (row) => row.currency)
  assert.equal(totals.get('USD'), 15)
  assert.equal(totals.get('CNY'), 20)
  assert.equal(hasMultipleCurrencies(totals), true)
})

test('formatCurrencyTotals joins formatted totals in insertion order', () => {
  const totals = new Map<string, number>([
    ['USD', 10],
    ['CNY', 20],
  ])

  const formatted = formatCurrencyTotals(totals)
  assert.match(formatted, /\$10\.00/)
  assert.match(formatted, /(CN¥|¥)20\.00/)
  assert.match(formatted, / · /)

  const negated = formatCurrencyTotals(totals, (amount) => -amount)
  assert.match(negated, /-\$10\.00|\$-10\.00/)
})
