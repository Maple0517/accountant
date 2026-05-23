import Link from 'next/link'
import { redirect } from 'next/navigation'
import AnalyticsCharts from '@/components/analytics/AnalyticsCharts'
import { getCurrentUser } from '@/lib/auth/server'
import { formatCurrency } from '@/lib/currency'
import {
  getAnalyticsSummary,
  parseAnalyticsPeriod,
} from '@/modules/analytics/analytics.service'
import type { AnalyticsPeriod } from '@/modules/analytics/analytics.types'

type AnalyticsPageProps = {
  searchParams: Promise<{
    period?: string
  }>
}

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
}

function periodHref(period: AnalyticsPeriod) {
  return period === 'month' ? '/analytics' : `/analytics?period=${period}`
}

export default async function AnalyticsPage({
  searchParams,
}: AnalyticsPageProps) {
  const { supabase, user } = await getCurrentUser()

  if (!user) {
    redirect('/auth/login')
  }

  const params = await searchParams
  const period = parseAnalyticsPeriod(params.period ?? null)
  const data = await getAnalyticsSummary(supabase, user.id, period)
  const hasData = data.totalSpending > 0 || data.totalIncome > 0

  return (
    <div className="analytics-page">
      <div className="page-header">
        <h1>Analytics</h1>
        <div className="period-toggle">
          {(['week', 'month', 'year'] as const).map((p) => (
            <Link
              key={p}
              className={`btn btn-ghost ${period === p ? 'active' : ''}`}
              href={periodHref(p)}
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="card empty-state">
          <span style={{ fontSize: '3rem' }}>📊</span>
          <h3>No data yet</h3>
          <p className="text-secondary">
            Connect a bank account to see your spending analytics.
          </p>
        </div>
      ) : (
        <>
          <div className="summary-grid">
            <div className="card summary-card expense">
              <span className="summary-label">Total Spending</span>
              <span className="summary-value">
                {formatCurrency(-data.totalSpending, 'USD')}
              </span>
            </div>
            <div className="card summary-card income">
              <span className="summary-label">Total Income</span>
              <span className="summary-value">
                {formatCurrency(data.totalIncome, 'USD')}
              </span>
            </div>
            <div className="card summary-card net">
              <span className="summary-label">Net</span>
              <span className="summary-value">
                {formatCurrency(data.totalIncome - data.totalSpending, 'USD')}
              </span>
            </div>
            <div className="card summary-card categories">
              <span className="summary-label">Categories</span>
              <span className="summary-value">{data.byCategory.length}</span>
            </div>
          </div>

          <AnalyticsCharts data={data} />

          <div className="card">
            <h3 style={{ padding: '1.25rem 1.25rem 0' }}>Top Categories</h3>
            <div className="category-list">
              {data.byCategory.slice(0, 8).map((cat) => {
                const percentage =
                  data.totalSpending > 0
                    ? (cat.total / data.totalSpending) * 100
                    : 0
                return (
                  <div key={cat.name} className="category-item">
                    <div className="cat-info">
                      <span className="cat-icon">{cat.icon}</span>
                      <span className="cat-name">{cat.name}</span>
                    </div>
                    <div className="cat-bar-wrapper">
                      <div
                        className="cat-bar"
                        style={{
                          width: `${percentage}%`,
                          backgroundColor: cat.color || '#6c5ce7',
                        }}
                      />
                    </div>
                    <div className="cat-amount">
                      <span className="cat-value">
                        {formatCurrency(-cat.total, 'USD')}
                      </span>
                      <span className="cat-pct">{percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
