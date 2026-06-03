'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { AnalyticsExploreSection } from '@/components/analytics/AnalyticsExploreSection'
import { BudgetImpactPanel } from '@/components/analytics/BudgetImpactPanel'
import { ChangeDriversPanel } from '@/components/analytics/ChangeDriversPanel'
import { InsightsVerdictCard } from '@/components/analytics/InsightsVerdictCard'
import { NeedsAttentionPanel } from '@/components/analytics/NeedsAttentionPanel'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import type { AnalyticsData, AnalyticsPeriod } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

const PERIOD_LABEL_KEYS: Record<AnalyticsPeriod, string> = {
  week: 'analytics.week',
  month: 'analytics.month',
  year: 'analytics.year',
}

function periodHref(period: AnalyticsPeriod, currency?: string) {
  const params = new URLSearchParams()
  if (period !== 'month') params.set('period', period)
  if (currency) params.set('currency', currency)
  const query = params.toString()
  return query ? `/analytics?${query}` : '/analytics'
}

const fetcher = async (url: string): Promise<AnalyticsData> => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to fetch')
  return json.data
}

export default function AnalyticsPage() {
  const { t } = useI18n()
  const searchParams = useSearchParams()
  const periodParam = searchParams.get('period')
  const currencyParam = searchParams.get('currency')
  const period: AnalyticsPeriod = periodParam === 'week' || periodParam === 'year' ? periodParam : 'month'
  const selectedCurrency = currencyParam === 'CNY' ? 'CNY' : currencyParam === 'USD' ? 'USD' : ''
  const query = new URLSearchParams({ period })
  if (selectedCurrency) query.set('currency', selectedCurrency)
  const { data, error, isLoading } = useSWR(`/api/analytics?${query.toString()}`, fetcher)
  const hasData = data && (data.totalSpending > 0 || data.totalIncome > 0)
  const currencyCode = data?.currencyCode || selectedCurrency || 'USD'

  return (
    <div className="analytics-page">
      <PageHeader
        title={t('analytics.title')}
        subtitle={t('analytics.subtitle')}
        actions={
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="period-toggle">
              {(['week', 'month', 'year'] as const).map((p) => (
                <Link key={p} className={`btn btn-ghost ${period === p ? 'active' : ''}`} href={periodHref(p, selectedCurrency || undefined)}>
                  {t(PERIOD_LABEL_KEYS[p])}
                </Link>
              ))}
            </div>
            <div className="period-toggle" aria-label={t('analytics.currencyScope')}>
              {(['USD', 'CNY'] as const).map((currency) => (
                <Link
                  key={currency}
                  className={`btn btn-ghost ${currencyCode === currency ? 'active' : ''}`}
                  href={periodHref(period, currency)}
                >
                  {currency}
                </Link>
              ))}
            </div>
          </div>
        }
      />

      {isLoading && !data && <div className="skeleton-card insights-loading-card" />}
      {error && !data && <div className="alert alert-error">{error.message}</div>}

      {data && !hasData && (
        <EmptyState title={t('analytics.noDataTitle')}>{t('analytics.noDataCopy')}</EmptyState>
      )}

      {data && hasData && (
        <>
          <InsightsVerdictCard data={data} />
          <div className="insights-primary-grid">
            <NeedsAttentionPanel data={data} />
            <ChangeDriversPanel data={data} />
          </div>
          <BudgetImpactPanel data={data} />
          <AnalyticsExploreSection data={data} />
        </>
      )}
    </div>
  )
}
