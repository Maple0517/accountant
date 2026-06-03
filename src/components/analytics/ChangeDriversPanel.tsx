'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsChangeDriver, AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

function DriverRow({ driver, currencyCode }: { driver: AnalyticsChangeDriver; currencyCode: string }) {
  const { locale } = useI18n()
  const label = locale === 'zh' && driver.labelZh ? driver.labelZh : driver.label
  const positive = driver.delta >= 0

  return (
    <Link href={driver.href} className="insights-driver-row">
      <div className="cat-info">
        {driver.icon && <span className="cat-icon">{driver.icon}</span>}
        <span className="cat-name">{label}</span>
      </div>
      <div className={positive ? 'delta-positive' : 'delta-negative'}>
        {positive ? '+' : ''}
        {formatCurrency(driver.delta, currencyCode)}
      </div>
    </Link>
  )
}

export function ChangeDriversPanel({ data }: { data: AnalyticsData }) {
  const { t } = useI18n()
  const drivers = data.changeDrivers.categories.slice(0, 5)

  return (
    <Card padding="none" className="insights-panel">
      <div className="card-header">
        <div>
          <h3>{t('analytics.whatChanged')}</h3>
          <p className="card-subtitle">{t('analytics.whatChangedSubtitle')}</p>
        </div>
      </div>
      {drivers.length === 0 ? (
        <div className="insights-empty-row">{t('analytics.noChangeDrivers')}</div>
      ) : (
        <div className="insights-driver-list">
          {drivers.map((driver) => (
            <DriverRow key={driver.id} driver={driver} currencyCode={data.currencyCode} />
          ))}
        </div>
      )}
    </Card>
  )
}
