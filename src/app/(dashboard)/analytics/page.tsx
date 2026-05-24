'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import AnalyticsCharts from '@/components/analytics/AnalyticsCharts'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsData, AnalyticsPeriod } from '@/modules/analytics/analytics.types'

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
}

function periodHref(period: AnalyticsPeriod) {
  return period === 'month' ? '/analytics' : `/analytics?period=${period}`
}

const fetcher = async (url: string): Promise<AnalyticsData> => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to fetch')
  return json.data
}

export default function AnalyticsPage() {
  const searchParams = useSearchParams()
  const periodParam = searchParams.get('period')
  const period: AnalyticsPeriod = periodParam === 'week' || periodParam === 'year' ? periodParam : 'month'
  const { data, error, isLoading } = useSWR(`/api/analytics?period=${period}`, fetcher)
  const hasData = data && (data.totalSpending > 0 || data.totalIncome > 0)
  const topCategory = data?.byCategory[0]
  const topDay = data?.byDay.reduce((max, day) => day.total > max.total ? day : max, { date: '', total: 0 })
  const net = data ? data.totalIncome - data.totalSpending : 0
  const currencyCode = data?.currencyCode || 'USD'

  return (
    <div className="analytics-page">
      <PageHeader
        title="Insights"
        subtitle="Conclusions first, charts second: understand what changed in your money flow."
        actions={
          <div className="period-toggle">
            {(['week', 'month', 'year'] as const).map((p) => (
              <Link key={p} className={`btn btn-ghost ${period === p ? 'active' : ''}`} href={periodHref(p)}>
                {PERIOD_LABELS[p]}
              </Link>
            ))}
          </div>
        }
      />

      {isLoading && !data && <div className="skeleton-card" />}
      {error && !data && <div className="alert alert-error">{error.message}</div>}

      {data && !hasData && (
        <EmptyState title="No insight data yet">Connect a bank account to see spending trends, categories, and merchant patterns.</EmptyState>
      )}

      {data && hasData && (
        <>
          <div className="insight-grid">
            <Card className="insight-card">
              <span className="insight-kicker">This {PERIOD_LABELS[period].toLowerCase()}</span>
              <span className="insight-title">{formatCurrency(data.totalSpending, currencyCode)} spent</span>
              <p className="insight-copy">Income was {formatCurrency(data.totalIncome, currencyCode)}, leaving net {formatCurrency(net, currencyCode)}.</p>
            </Card>
            <Card className="insight-card">
              <span className="insight-kicker">Biggest category</span>
              <span className="insight-title">{topCategory ? `${topCategory.icon} ${topCategory.name}` : 'None'}</span>
              <p className="insight-copy">{topCategory ? `${formatCurrency(topCategory.total, currencyCode)} of budget-effective spending.` : 'No category spend yet.'}</p>
            </Card>
            <Card className="insight-card">
              <span className="insight-kicker">Peak day</span>
              <span className="insight-title">{topDay?.date || 'No daily spike'}</span>
              <p className="insight-copy">{topDay && topDay.total > 0 ? `${formatCurrency(topDay.total, currencyCode)} in spending on the highest day.` : 'Daily spend has not appeared yet.'}</p>
            </Card>
            <Card className="insight-card">
              <span className="insight-kicker">Categories used</span>
              <span className="insight-title">{data.byCategory.length}</span>
              <p className="insight-copy">Rankings use transaction semantics and budget-effective dates.</p>
            </Card>
          </div>

          <AnalyticsCharts data={data} currencyCode={currencyCode} />

          <Card padding="none">
            <div className="card-header">
              <div>
                <h3>Top categories</h3>
                <p className="card-subtitle">Share of spending for the selected period.</p>
              </div>
            </div>
            <div className="category-list">
              {data.byCategory.slice(0, 8).map((cat) => {
                const percentage = data.totalSpending > 0 ? (cat.total / data.totalSpending) * 100 : 0
                return (
                  <div key={cat.name} className="category-item">
                    <div className="cat-info">
                      <span className="cat-icon">{cat.icon}</span>
                      <span className="cat-name">{cat.name}</span>
                    </div>
                    <div className="cat-bar-wrapper">
                      <div className="cat-bar" style={{ width: `${percentage}%`, backgroundColor: cat.color || '#7c5cff' }} />
                    </div>
                    <div className="cat-amount">
                      <span className="cat-value">{formatCurrency(cat.total, currencyCode)}</span>
                      <span className="cat-pct">{percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
