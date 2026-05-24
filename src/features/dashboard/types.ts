import type { MonthlyBudgetSummary } from '@/modules/budget/budget.types'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'

export type DashboardAccount = {
  type?: string | null
  current_balance?: number | string | null
  available_balance?: number | string | null
}

export type DashboardMonthTransaction = {
  id?: string
  amount: number | string
  pending?: boolean | null
  category_id?: string | null
  tags?: string[] | null
  transaction_kind?: string | null
  budget_behavior?: string | null
  budget_effective_date?: string | null
  date: string
  transfer_match_status?: string | null
}

export type DashboardRecentTransaction = {
  id: string
  merchant_name?: string | null
  description?: string | null
  amount: number | string
  date: string
  source: string
  pending?: boolean | null
  tags?: string[] | null
  transaction_kind?: string | null
  budget_behavior?: string | null
  transfer_match_status?: string | null
  accounts?: { name?: string | null; mask?: string | null } | { name?: string | null; mask?: string | null }[] | null
  categories?: { name?: string | null; name_zh?: string | null; icon?: string | null; color?: string | null } | { name?: string | null; name_zh?: string | null; icon?: string | null; color?: string | null }[] | null
}

export type DashboardData = {
  accounts: DashboardAccount[]
  monthTx: DashboardMonthTransaction[]
  recentTx: DashboardRecentTransaction[]
  analytics: AnalyticsData | null
  budget: MonthlyBudgetSummary | null
  generatedAt?: string
}
