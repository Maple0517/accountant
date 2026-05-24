import { formatCurrency } from '@/lib/currency'
import { normalizeCurrencyCode } from './currency'

export function sumByCurrency<T>(
  rows: T[],
  getAmount: (row: T) => number,
  getCurrency: (row: T) => string | null | undefined
): Map<string, number> {
  const totals = new Map<string, number>()

  for (const row of rows) {
    const amount = getAmount(row)
    if (!Number.isFinite(amount)) continue

    const currency = normalizeCurrencyCode(getCurrency(row))
    totals.set(currency, (totals.get(currency) || 0) + amount)
  }

  return totals
}

export function hasMultipleCurrencies(
  totals: Map<string, number> | Iterable<string>
): boolean {
  if (totals instanceof Map) {
    return totals.size > 1
  }

  const seen = new Set<string>()
  for (const currency of totals) {
    seen.add(normalizeCurrencyCode(currency))
    if (seen.size > 1) return true
  }

  return false
}

export function formatCurrencyTotals(
  totals: Map<string, number>,
  transformAmount: (amount: number) => number = (amount) => amount
): string {
  if (totals.size === 0) {
    return formatCurrency(0, 'USD')
  }

  return Array.from(totals.entries())
    .map(([currency, amount]) => formatCurrency(transformAmount(amount), currency))
    .join(' · ')
}
