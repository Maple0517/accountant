'use client'

import useSWR from 'swr'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { FinancialSnapshot } from '@/features/dashboard/FinancialSnapshot'
import { NeedsReviewCard } from '@/features/dashboard/NeedsReviewCard'
import { BudgetHealthCard } from '@/features/dashboard/BudgetHealthCard'
import { SpendingTrendCard } from '@/features/dashboard/SpendingTrendCard'
import { RecentActivityCard } from '@/features/dashboard/RecentActivityCard'
import type { DashboardData } from '@/features/dashboard/types'
import { useI18n } from '@/i18n/client'
import {
  getMonthlySemanticAmounts,
  getReviewCounts,
  summarizeBalances,
} from '@/features/dashboard/dashboard-utils'
import { normalizeCurrencyCode } from '@/lib/money/currency'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'
import type { MonthlyBudgetSummary } from '@/modules/budget/budget.types'

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to fetch')
  return (json.data ?? json) as T
}

export default function DashboardPage() {
  const { t } = useI18n()
  const { data, error, isLoading } = useSWR<DashboardData>('/api/dashboard', fetcher)

  const currencyCode = data?.currencyCode || 'USD'
  const currentMonth = data?.currentMonth
  const analyticsKey = data ? `/api/analytics?period=month&currency=${currencyCode}` : null
  const budgetKey = currentMonth ? `/api/budget/monthly-summary?month=${currentMonth}` : null
  const { data: analyticsData } = useSWR<AnalyticsData>(analyticsKey, fetcher)
  const { data: budgetData } = useSWR<MonthlyBudgetSummary>(budgetKey, fetcher)
  const analytics = analyticsData ?? data?.analytics ?? null
  const budget = budgetData ?? data?.budget ?? null
  const balances = summarizeBalances(data?.accounts ?? [], currencyCode)
  const monthlyTotals = (data?.monthTx ?? []).reduce(
    (totals, tx) => {
      if (normalizeCurrencyCode(tx.iso_currency_code) !== currencyCode) {
        return totals
      }
      const amounts = getMonthlySemanticAmounts(tx)
      totals.spending += amounts.spending
      totals.income += amounts.income
      return totals
    },
    { spending: 0, income: 0 }
  )
  const reviewCounts = getReviewCounts(data?.monthTx ?? [])

  return (
    <div className="dashboard">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
      />

      {isLoading && !data && (
        <div className="loading-state animate-fade-in">
          <Card padding="lg">
            <Skeleton className="skeleton-line" />
            <Skeleton className="skeleton-line mt-2" />
          </Card>
          <div className="dashboard-snapshot-grid">
            {[1, 2, 3, 4, 5].map((item) => <div key={item} className="skeleton-card" />)}
          </div>
        </div>
      )}

      {error && !data && (
        <div className="alert alert-error">{error.message}</div>
      )}

      {data && (
        <>
          <FinancialSnapshot
            cash={balances.cash}
            cardDebt={balances.cardDebt}
            monthlySpending={monthlyTotals.spending}
            monthlyIncome={monthlyTotals.income}
            budgetLeft={budget?.totalRemaining ?? null}
            currencyCode={currencyCode}
          />

          <div className="dashboard-grid">
            <div className="dashboard-stack">
              <NeedsReviewCard counts={reviewCounts} />
              <SpendingTrendCard analytics={analytics} />
            </div>
            <div className="dashboard-stack">
              <BudgetHealthCard summary={budget} />
              <RecentActivityCard transactions={data.recentTx ?? []} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
