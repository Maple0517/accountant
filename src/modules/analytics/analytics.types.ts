export type AnalyticsPeriod = 'week' | 'month' | 'year'

export type AnalyticsData = {
  totalSpending: number
  totalIncome: number
  currencyCode: string
  availableCurrencies?: string[]
  byCategory: Array<{ name: string; name_zh?: string | null; icon: string; color: string; total: number }>
  byMonth: Array<{ month: string; spending: number; income: number }>
  byDay: Array<{ date: string; total: number }>
}
