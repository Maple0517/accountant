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
import { useI18n } from '@/i18n/client'

const PERIOD_LABEL_KEYS: Record<AnalyticsPeriod, string> = {
  week: 'analytics.week',
  month: 'analytics.month',
  year: 'analytics.year',
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
  const { categoryName, t } = useI18n()
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
        title={t('analytics.title')}
        subtitle={t('analytics.subtitle')}
        actions={
          <div className="period-toggle">
            {(['week', 'month', 'year'] as const).map((p) => (
              <Link key={p} className={`btn btn-ghost ${period === p ? 'active' : ''}`} href={periodHref(p)}>
                {t(PERIOD_LABEL_KEYS[p])}
              </Link>
            ))}
          </div>
        }
      />

      {isLoading && !data && <div className="skeleton-card" />}
      {error && !data && <div className="alert alert-error">{error.message}</div>}

      {data && !hasData && (
        <EmptyState title={t('analytics.noDataTitle')}>{t('analytics.noDataCopy')}</EmptyState>
      )}

      {data && hasData && (
        <>
          <div className="insight-grid">
            <Card className="insight-card">
              <span className="insight-kicker">{t('analytics.thisPeriod', { period: t(PERIOD_LABEL_KEYS[period]).toLowerCase() })}</span>
              <span className="insight-title">{t('analytics.spentTitle', { amount: formatCurrency(data.totalSpending, currencyCode) })}</span>
              <p className="insight-copy">{t('analytics.netCopy', { income: formatCurrency(data.totalIncome, currencyCode), net: formatCurrency(net, currencyCode) })}</p>
            </Card>
            <Card className="insight-card">
              <span className="insight-kicker">{t('analytics.biggestCategory')}</span>
              <span className="insight-title">{topCategory ? `${topCategory.icon} ${categoryName(topCategory)}` : t('common.none')}</span>
              <p className="insight-copy">{topCategory ? t('analytics.categorySpendCopy', { amount: formatCurrency(topCategory.total, currencyCode) }) : t('analytics.noCategorySpend')}</p>
            </Card>
            <Card className="insight-card">
              <span className="insight-kicker">{t('analytics.peakDay')}</span>
              <span className="insight-title">{topDay?.date || t('analytics.noDailySpike')}</span>
              <p className="insight-copy">{topDay && topDay.total > 0 ? t('analytics.peakDayCopy', { amount: formatCurrency(topDay.total, currencyCode) }) : t('analytics.noDailySpend')}</p>
            </Card>
            <Card className="insight-card">
              <span className="insight-kicker">{t('analytics.categoriesUsed')}</span>
              <span className="insight-title">{data.byCategory.length}</span>
              <p className="insight-copy">{t('analytics.rankingsCopy')}</p>
            </Card>
          </div>

          <AnalyticsCharts data={data} currencyCode={currencyCode} />

          <Card padding="none">
            <div className="card-header">
              <div>
                <h3>{t('analytics.topCategories')}</h3>
                <p className="card-subtitle">{t('analytics.topCategoriesSubtitle')}</p>
              </div>
            </div>
            <div className="category-list">
              {data.byCategory.slice(0, 8).map((cat) => {
                const percentage = data.totalSpending > 0 ? (cat.total / data.totalSpending) * 100 : 0
                return (
                  <div key={cat.name} className="category-item">
                    <div className="cat-info">
                      <span className="cat-icon">{cat.icon}</span>
                      <span className="cat-name">{categoryName(cat)}</span>
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
