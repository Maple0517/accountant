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
import {
  getMonthlySemanticAmounts,
  getReviewCounts,
  summarizeBalances,
} from '@/features/dashboard/dashboard-utils'

const fetcher = async (url: string): Promise<DashboardData> => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to fetch')
  return json.data
}

export default function DashboardPage() {
  const { data, error, isLoading } = useSWR('/api/dashboard', fetcher)

  const balances = summarizeBalances(data?.accounts ?? [])
  const monthlyTotals = (data?.monthTx ?? []).reduce(
    (totals, tx) => {
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
        title="Overview"
        subtitle="Understand your current financial state and what needs attention."
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
            budgetLeft={data.budget?.totalRemaining ?? null}
          />

          <div className="dashboard-grid">
            <div className="dashboard-stack">
              <NeedsReviewCard counts={reviewCounts} />
              <SpendingTrendCard analytics={data.analytics} />
            </div>
            <div className="dashboard-stack">
              <BudgetHealthCard summary={data.budget} />
              <RecentActivityCard transactions={data.recentTx ?? []} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
