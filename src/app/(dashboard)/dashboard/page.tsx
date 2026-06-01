'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { FinancialSnapshot } from '@/features/dashboard/FinancialSnapshot'
import { formatCurrency } from '@/lib/currency'
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

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to fetch')
  return (json.data ?? json) as T
}

export default function DashboardPage() {
  const { t } = useI18n()
  const { data, error, isLoading } = useSWR<DashboardData>('/api/dashboard?include=full', fetcher)

  const currencyCode = data?.currencyCode || 'USD'
  const analytics = data?.analytics ?? null
  const budget = data?.budget ?? null
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
  const reviewTotal = Object.values(reviewCounts).reduce((sum, count) => sum + count, 0)
  const budgetLeft = budget?.totalRemaining ?? null
  const budgetPercent = budget?.totalPercentUsed ?? null

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
          <section className="home-hero">
            <div className="home-hero-primary">
              <span className="metric-label">{t('dashboard.budgetLeft')}</span>
              <strong className={`home-hero-value ${budgetLeft !== null && budgetLeft < 0 ? 'negative' : ''}`}>
                {budgetLeft === null ? t('dashboard.notSet') : formatCurrency(budgetLeft, currencyCode)}
              </strong>
              <p className="text-secondary">
                {budgetPercent === null
                  ? t('dashboard.setCategoryBudgets')
                  : t('dashboard.monthProgress', { percent: Math.round(budgetPercent * 100) })}
              </p>
              <div className="home-hero-actions">
                <Link className="btn btn-primary btn-md" href="/review">{t('dashboard.openInbox')}</Link>
                <Link className="btn btn-ghost btn-md" href="/budgets">{t('dashboard.manageBudgets')}</Link>
              </div>
            </div>
            <div className="home-hero-secondary">
              <div>
                <span className="metric-label">{t('dashboard.needsReview')}</span>
                <strong>{reviewTotal}</strong>
                <p>{reviewTotal === 0 ? t('dashboard.noReviewItems') : t('dashboard.itemsNeedAttention', { count: reviewTotal, plural: reviewTotal === 1 ? '' : 's' })}</p>
              </div>
              <div>
                <span className="metric-label">{t('dashboard.thisMonth')}</span>
                <strong>{formatCurrency(monthlyTotals.spending, currencyCode)}</strong>
                <p>{monthlyTotals.income > 0 ? t('dashboard.savingsRate', { rate: Math.round(Math.max(0, (monthlyTotals.income - monthlyTotals.spending) / monthlyTotals.income) * 100) }) : t('dashboard.noIncome')}</p>
              </div>
              <div>
                <span className="metric-label">{t('dashboard.cash')}</span>
                <strong>{formatCurrency(balances.cash, currencyCode)}</strong>
                <p>{t('dashboard.cashHelper')}</p>
              </div>
            </div>
          </section>

          <div className="dashboard-grid">
            <div className="dashboard-stack">
              <NeedsReviewCard counts={reviewCounts} />
              <RecentActivityCard transactions={data.recentTx ?? []} />
            </div>
            <div className="dashboard-stack">
              <BudgetHealthCard summary={budget} />
              <SpendingTrendCard analytics={analytics} />
            </div>
          </div>

          <FinancialSnapshot
            cash={balances.cash}
            cardDebt={balances.cardDebt}
            monthlySpending={monthlyTotals.spending}
            monthlyIncome={monthlyTotals.income}
            budgetLeft={budgetLeft}
            currencyCode={currencyCode}
          />
        </>
      )}
    </div>
  )
}
