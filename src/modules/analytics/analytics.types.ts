export type AnalyticsPeriod = 'week' | 'month' | 'year'

export type AnalyticsData = {
  totalSpending: number
  totalIncome: number
  currencyCode: string
  byCategory: Array<{ name: string; icon: string; color: string; total: number }>
  byMonth: Array<{ month: string; spending: number; income: number }>
  byDay: Array<{ date: string; total: number }>
}
