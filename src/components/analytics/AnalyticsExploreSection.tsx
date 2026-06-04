'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

const AnalyticsCharts = dynamic(() => import('./AnalyticsCharts'), {
  loading: () => <div className="skeleton-card chart-loading-card" />,
})

export function AnalyticsExploreSection({ data }: { data: AnalyticsData }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const driverCount = data.changeDrivers.categories.length + data.changeDrivers.merchants.length
  const activeCategoryCount = data.byCategory.filter((category) => category.total > 0).length
  const hasChartData = data.byDay.length > 0 || data.byCategory.length > 0

  return (
    <section className="insights-explore-section collapsed">
      <Card className="insights-explore-hero compact" padding="lg">
        <div className="insights-section-heading">
          <span className="insights-kicker">{t('analytics.exploreKicker')}</span>
          <h2>{t('analytics.explore')}</h2>
          <p>{t('analytics.exploreCollapsedSubtitle')}</p>
        </div>
        <div className="insights-explore-actions">
          <div className="insights-explore-metrics compact">
            <div>
              <span>{t('analytics.explorePeriodSpend')}</span>
              <strong>{formatCurrency(data.totalSpending, data.currencyCode)}</strong>
            </div>
            <div>
              <span>{t('analytics.exploreDrivers')}</span>
              <strong>{driverCount}</strong>
            </div>
            <div>
              <span>{t('analytics.exploreCategories')}</span>
              <strong>{activeCategoryCount}</strong>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm insights-explore-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? t('analytics.hideChartDetails') : t('analytics.showChartDetails')}
          </button>
        </div>
      </Card>

      {expanded && (
        hasChartData ? (
          <div className="insights-chart-shell">
            <AnalyticsCharts data={data} currencyCode={data.currencyCode} />
          </div>
        ) : (
          <Card className="insights-empty-row">{t('analytics.noExploreData')}</Card>
        )
      )}
    </section>
  )
}
