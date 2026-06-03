export type AnalyticsPeriod = 'week' | 'month' | 'year'

export type AnalyticsHealthStatus = 'healthy' | 'watch' | 'danger'

export type AnalyticsCategoryTotal = {
  id?: string | null
  name: string
  name_zh?: string | null
  icon: string
  color: string
  total: number
}

export type AnalyticsPeriodWindow = {
  period: AnalyticsPeriod
  startDate: string
  endDate: string
  comparisonStartDate: string
  comparisonEndDate: string
}

export type AnalyticsTotals = {
  spending: number
  income: number
  net: number
  previousSpending: number
  previousIncome: number
  previousNet: number
  spendingDelta: number
  incomeDelta: number
  netDelta: number
}

export type AnalyticsVerdict = {
  status: AnalyticsHealthStatus
  headlineKey: string
  reasonKeys: string[]
  primaryAmount?: number
}

export type AnalyticsAttentionKind =
  | 'over_budget'
  | 'at_risk_budget'
  | 'unusual_category'
  | 'review_queue'
  | 'uncategorized'
  | 'ai_pending'

export type AnalyticsActionTarget = 'transactions' | 'budgets'

export type AnalyticsAttentionItem = {
  id: string
  kind: AnalyticsAttentionKind
  severity: AnalyticsHealthStatus
  titleKey: string
  bodyKey: string
  amount?: number
  categoryId?: string | null
  categoryName?: string
  categoryNameZh?: string | null
  href: string
  actionTarget: AnalyticsActionTarget
}

export type AnalyticsChangeDriver = {
  id: string
  label: string
  labelZh?: string | null
  icon?: string | null
  color?: string | null
  current: number
  previous: number
  delta: number
  href: string
}

export type AnalyticsBudgetImpactItem = {
  categoryId: string
  categoryName: string
  categoryNameZh?: string | null
  status: 'over' | 'at_risk' | 'on_track' | 'no_budget'
  actualSpend: number
  baseBudget: number
  remaining: number
  percentUsed: number | null
  projectedSpend: number | null
  transactionsHref: string
  budgetHref: string
}

export type AnalyticsBudgetImpact = {
  month: string | null
  currencyCode: string
  groups: {
    over: AnalyticsBudgetImpactItem[]
    atRisk: AnalyticsBudgetImpactItem[]
    onTrack: AnalyticsBudgetImpactItem[]
    noBudget: AnalyticsBudgetImpactItem[]
  }
}

export type AnalyticsData = {
  totalSpending: number
  totalIncome: number
  currencyCode: string
  availableCurrencies?: string[]
  categorySpendingTotal: number
  byCategory: AnalyticsCategoryTotal[]
  byMonth: Array<{ month: string; spending: number; income: number }>
  byDay: Array<{ date: string; total: number }>
  periodWindow: AnalyticsPeriodWindow
  totals: AnalyticsTotals
  verdict: AnalyticsVerdict
  attentionItems: AnalyticsAttentionItem[]
  changeDrivers: {
    categories: AnalyticsChangeDriver[]
    merchants: AnalyticsChangeDriver[]
  }
  budgetImpact: AnalyticsBudgetImpact | null
}
