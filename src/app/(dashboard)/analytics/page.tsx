'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import AnalyticsCharts from '@/components/analytics/AnalyticsCharts'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsPeriod } from '@/modules/analytics/analytics.types'

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
}

function periodHref(period: AnalyticsPeriod) {
  return period === 'month' ? '/analytics' : `/analytics?period=${period}`
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to fetch')
  return json.data
}

export default function AnalyticsPage() {
  const searchParams = useSearchParams()
  const periodParam = searchParams.get('period')
  
  // parseAnalyticsPeriod logic on client:
  const period: AnalyticsPeriod = 
    periodParam === 'week' || periodParam === 'year' ? periodParam : 'month'

  const { data, error, isLoading } = useSWR(`/api/analytics?period=${period}`, fetcher)

  const hasData = data && (data.totalSpending > 0 || data.totalIncome > 0)

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

      {isLoading && !data && (
        <div className="loading-state animate-fade-in">
          <div className="card skeleton-card" style={{ height: '300px' }} />
        </div>
      )}

      {error && !data && (
         <div className="card alert alert-error" style={{ padding: '1.5rem' }}>
           ⚠️ {error.message}
         </div>
      )}

      {data && !hasData && (
        <div className="card empty-state">
          <span style={{ fontSize: '3rem' }}>📊</span>
          <h3>No data yet</h3>
          <p className="text-secondary">
            Connect a bank account to see your spending analytics.
          </p>
        </div>
      )}

      {data && hasData && (
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
              {data.byCategory.slice(0, 8).map((cat: any) => {
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
