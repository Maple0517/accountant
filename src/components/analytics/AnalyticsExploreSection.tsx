'use client'

import { Card } from '@/components/ui/Card'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'
import AnalyticsCharts from './AnalyticsCharts'

export function AnalyticsExploreSection({ data }: { data: AnalyticsData }) {
  const { t } = useI18n()

  return (
    <section className="insights-explore-section">
      <div className="insights-section-heading">
        <h2>{t('analytics.explore')}</h2>
        <p>{t('analytics.exploreSubtitle')}</p>
      </div>
      {data.byDay.length === 0 && data.byCategory.length === 0 ? (
        <Card className="insights-empty-row">{t('analytics.noExploreData')}</Card>
      ) : (
        <AnalyticsCharts data={data} currencyCode={data.currencyCode} />
      )}
    </section>
  )
}
