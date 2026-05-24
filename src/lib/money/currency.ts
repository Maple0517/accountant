export function normalizeCurrencyCode(currency?: string | null): string {
  const normalized = currency?.trim().toUpperCase()
  return normalized || 'USD'
}

export function isSameCurrency(
  currency: string | null | undefined,
  targetCurrency: string
): boolean {
  return normalizeCurrencyCode(currency) === normalizeCurrencyCode(targetCurrency)
}

export function filterByCurrency<T>(
  rows: T[],
  targetCurrency: string,
  getCurrency: (row: T) => string | null | undefined
): T[] {
  const normalizedTarget = normalizeCurrencyCode(targetCurrency)
  return rows.filter((row) => normalizeCurrencyCode(getCurrency(row)) === normalizedTarget)
}
