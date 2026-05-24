import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'
import { formatShortDate } from './dashboard-utils'
import { useI18n } from '@/i18n/client'

export function SpendingTrendCard({ analytics }: { analytics: AnalyticsData | null }) {
  const { t } = useI18n()
  const days = analytics?.byDay ?? []
  const max = Math.max(...days.map((day) => day.total), 0)
  const currencyCode = analytics?.currencyCode || 'USD'

  return (
    <Card padding="none" className="dashboard-panel">
      <div className="card-header">
        <div>
          <h3>{t('dashboard.spendingTrend')}</h3>
          <p className="card-subtitle">{t('dashboard.spendingTrendSubtitle')}</p>
        </div>
        <span className="text-secondary text-sm">{analytics ? formatCurrency(analytics.totalSpending, currencyCode) : t('common.noData')}</span>
      </div>
      {days.length > 0 && max > 0 ? (
        <div className="trend-bars" aria-label={t('dashboard.dailySpendingChart')}>
          {days.map((day) => (
            <div className="trend-bar-wrap" key={day.date} title={`${formatShortDate(day.date)} · ${formatCurrency(day.total, currencyCode)}`}>
              <div className="trend-bar" style={{ height: `${Math.max(6, (day.total / max) * 100)}%` }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="trend-empty">{t('dashboard.noSpendingTrend')}</div>
      )}
    </Card>
  )
}
