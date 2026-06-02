'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { formatCurrency } from '@/lib/currency'
import { NeedsReviewCard } from '@/features/dashboard/NeedsReviewCard'
import { BudgetHealthCard } from '@/features/dashboard/BudgetHealthCard'
import { RecentActivityCard } from '@/features/dashboard/RecentActivityCard'
import type { DashboardData } from '@/features/dashboard/types'
import { useI18n } from '@/i18n/client'
import {
  formatShortDate,
  getDashboardStatusSummary,
  getLargestSpendingDriver,
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

function getBudgetTone(budgetLeft: number | null, budgetPercent: number | null) {
  if (budgetLeft !== null && budgetLeft < 0) return 'danger' as const
  if (budgetPercent !== null && budgetPercent >= 0.8) return 'warning' as const
  if (budgetLeft !== null || budgetPercent !== null) return 'success' as const
  return 'muted' as const
}

function statusLabelKey(tone: ReturnType<typeof getBudgetTone>) {
  if (tone === 'danger') return 'dashboard.overBudget'
  if (tone === 'warning') return 'dashboard.watchClosely'
  if (tone === 'success') return 'dashboard.safe'
  return 'dashboard.notConfigured'
}

export default function DashboardPage() {
  const { t } = useI18n()
  const { data, error, isLoading } = useSWR<DashboardData>('/api/dashboard?include=full', fetcher)

  const currencyCode = data?.currencyCode || 'USD'
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
  const budgetTone = getBudgetTone(budgetLeft, budgetPercent)
  const largestDriver = getLargestSpendingDriver(data?.monthTx ?? [], currencyCode)
  const statusSummary = getDashboardStatusSummary({
    budgetLeft,
    budgetPercent,
    reviewTotal,
    monthlySpending: monthlyTotals.spending,
    largestDriverLabel: largestDriver?.label,
  })

  return (
    <div className="dashboard dashboard-cockpit">
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
          <section className="money-cockpit-hero">
            <div className="money-cockpit-main">
              <div className="money-cockpit-header-row">
                <div>
                  <span className="metric-label">{t('dashboard.moneyStatus')}</span>
                  <h2>{statusSummary}</h2>
                  <p className="text-secondary">
                    {budgetPercent === null
                      ? t('dashboard.setCategoryBudgets')
                      : t('dashboard.monthProgress', { percent: Math.round(budgetPercent * 100) })}
                  </p>
                </div>
                <Badge tone={budgetTone === 'success' ? 'success' : budgetTone === 'warning' ? 'warning' : budgetTone === 'danger' ? 'danger' : 'muted'}>
                  {t(statusLabelKey(budgetTone))}
                </Badge>
              </div>

              <div className="cockpit-metric-grid">
                <div className="cockpit-metric-card primary">
                  <span className="metric-label">{t('dashboard.budgetLeft')}</span>
                  <strong className={budgetLeft !== null && budgetLeft < 0 ? 'negative' : ''}>
                    {budgetLeft === null ? t('dashboard.notSet') : formatCurrency(budgetLeft, currencyCode)}
                  </strong>
                  <p>{t('dashboard.budgetAware')}</p>
                </div>
                <div className="cockpit-metric-card spending">
                  <span className="metric-label">{t('dashboard.monthlySpend')}</span>
                  <strong>{formatCurrency(monthlyTotals.spending, currencyCode)}</strong>
                  <p>{monthlyTotals.income > 0 ? t('dashboard.savingsRate', { rate: Math.round(Math.max(0, (monthlyTotals.income - monthlyTotals.spending) / monthlyTotals.income) * 100) }) : t('dashboard.noIncome')}</p>
                </div>
                <div className="cockpit-metric-card">
                  <span className="metric-label">{t('dashboard.cash')}</span>
                  <strong>{formatCurrency(balances.cash, currencyCode)}</strong>
                  <p>{t('dashboard.cashHelper')}</p>
                </div>
              </div>
            </div>

            <div className="money-cockpit-rail">
              <Card padding="md" className="cockpit-action-card review-action">
                <div>
                  <span className="metric-label">{t('dashboard.needsReview')}</span>
                  <strong>{reviewTotal === 0 ? t('common.allClear') : reviewTotal}</strong>
                  <p>{reviewTotal === 0 ? t('dashboard.reviewClearedCopy') : t('dashboard.itemsNeedAttention', { count: reviewTotal, plural: reviewTotal === 1 ? '' : 's' })}</p>
                </div>
                <Link className="btn btn-ghost btn-sm" href="/review">{t('dashboard.openInbox')}</Link>
              </Card>

              <Card padding="md" className="cockpit-action-card top-driver-card">
                <div>
                  <span className="metric-label">{t('dashboard.topDriver')}</span>
                  {largestDriver ? (
                    <>
                      <strong>{largestDriver.label}</strong>
                      <p>
                        {formatCurrency(largestDriver.amount, largestDriver.currencyCode)} · {formatShortDate(largestDriver.date)}
                        {largestDriver.pending ? ` · ${t('common.pending')}` : ''}
                      </p>
                    </>
                  ) : (
                    <>
                      <strong>{t('common.noData')}</strong>
                      <p>{t('dashboard.noSpendingTrend')}</p>
                    </>
                  )}
                </div>
                {largestDriver ? (
                  <Link className="btn btn-ghost btn-sm" href={`/transactions?tx=${largestDriver.id}`}>{t('common.details')}</Link>
                ) : (
                  <Link className="btn btn-ghost btn-sm" href="/transactions">{t('dashboard.viewAll')}</Link>
                )}
              </Card>

              <Card padding="md" className="cockpit-action-card balance-action">
                <div>
                  <span className="metric-label">{t('dashboard.netWorth')}</span>
                  <strong>{formatCurrency(balances.cash - balances.cardDebt, currencyCode)}</strong>
                  <p>{t('dashboard.cashDebtSummary', { cash: formatCurrency(balances.cash, currencyCode), debt: formatCurrency(balances.cardDebt, currencyCode) })}</p>
                </div>
                <Link className="btn btn-ghost btn-sm" href="/accounts">{t('nav.accounts')}</Link>
              </Card>
            </div>
          </section>

          <div className="dashboard-grid action-dashboard-grid">
            <div className="dashboard-stack">
              <RecentActivityCard transactions={data.recentTx ?? []} />
            </div>
            <div className="dashboard-stack">
              <NeedsReviewCard counts={reviewCounts} />
              <BudgetHealthCard summary={budget} />
            </div>
          </div>

        </>
      )}
    </div>
  )
}
