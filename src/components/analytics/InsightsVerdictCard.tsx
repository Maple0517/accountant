'use client'

import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

export function InsightsVerdictCard({ data }: { data: AnalyticsData }) {
  const { t } = useI18n()
  const statusClass = `insights-verdict-card ${data.verdict.status}`

  return (
    <Card className={statusClass} padding="lg">
      <div className="insights-verdict-main">
        <span className="insights-kicker">{t('analytics.reviewVerdict')}</span>
        <h2>
          {t(data.verdict.headlineKey, {
            amount: data.verdict.primaryAmount
              ? formatCurrency(data.verdict.primaryAmount, data.currencyCode)
              : '',
          })}
        </h2>
        <p>
          {data.verdict.reasonKeys
            .map((key) => t(key))
            .filter(Boolean)
            .join(' ')}
        </p>
      </div>
      <div className="insights-verdict-metrics">
        <div>
          <span>{t('analytics.metricSpending')}</span>
          <strong>{formatCurrency(data.totals.spending, data.currencyCode)}</strong>
        </div>
        <div>
          <span>{t('analytics.metricIncome')}</span>
          <strong>{formatCurrency(data.totals.income, data.currencyCode)}</strong>
        </div>
        <div>
          <span>{t('analytics.metricNet')}</span>
          <strong>{formatCurrency(data.totals.net, data.currencyCode)}</strong>
        </div>
      </div>
    </Card>
  )
}
