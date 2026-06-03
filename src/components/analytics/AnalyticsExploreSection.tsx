'use client'

import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'
import AnalyticsCharts from './AnalyticsCharts'

export function AnalyticsExploreSection({ data }: { data: AnalyticsData }) {
  const { t } = useI18n()
  const driverCount = data.changeDrivers.categories.length + data.changeDrivers.merchants.length
  const activeCategoryCount = data.byCategory.filter((category) => category.total > 0).length

  return (
    <section className="insights-explore-section">
      <Card className="insights-explore-hero" padding="lg">
        <div className="insights-section-heading">
          <span className="insights-kicker">{t('analytics.exploreKicker')}</span>
          <h2>{t('analytics.explore')}</h2>
          <p>{t('analytics.exploreSubtitle')}</p>
        </div>
        <div className="insights-explore-metrics">
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
      </Card>

      {data.byDay.length === 0 && data.byCategory.length === 0 ? (
        <Card className="insights-empty-row">{t('analytics.noExploreData')}</Card>
      ) : (
        <div className="insights-chart-shell">
          <AnalyticsCharts data={data} currencyCode={data.currencyCode} />
        </div>
      )}
    </section>
  )
}
