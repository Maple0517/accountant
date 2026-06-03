'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsBudgetImpactItem, AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

function BudgetImpactRow({ item, currencyCode }: { item: AnalyticsBudgetImpactItem; currencyCode: string }) {
  const { locale, t } = useI18n()
  const name = locale === 'zh' && item.categoryNameZh ? item.categoryNameZh : item.categoryName

  return (
    <div className={`insights-budget-row ${item.status}`}>
      <Link href={item.transactionsHref} className="insights-budget-name">{name}</Link>
      <span>{formatCurrency(item.actualSpend, currencyCode)}</span>
      <span>{item.baseBudget > 0 ? formatCurrency(item.baseBudget, currencyCode) : t('budgets.notConfigured')}</span>
      <Link href={item.budgetHref} className="insights-action">{t('analytics.openBudget')}</Link>
    </div>
  )
}

export function BudgetImpactPanel({ data }: { data: AnalyticsData }) {
  const { t } = useI18n()
  const impact = data.budgetImpact

  if (!impact) {
    return (
      <Card padding="none" className="insights-panel">
        <div className="card-header">
          <div>
            <h3>{t('analytics.budgetImpact')}</h3>
            <p className="card-subtitle">{t('analytics.budgetImpactUnavailable')}</p>
          </div>
        </div>
      </Card>
    )
  }

  const visible = [
    ...impact.groups.over,
    ...impact.groups.atRisk,
    ...impact.groups.noBudget,
    ...impact.groups.onTrack.slice(0, 3),
  ]

  return (
    <Card padding="none" className="insights-panel insights-budget-panel">
      <div className="card-header">
        <div>
          <h3>{t('analytics.budgetImpact')}</h3>
          <p className="card-subtitle">{t('analytics.budgetImpactSubtitle')}</p>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="insights-empty-row">{t('analytics.noBudgetImpact')}</div>
      ) : (
        <div className="insights-budget-list">
          {visible.map((item) => (
            <BudgetImpactRow key={item.categoryId} item={item} currencyCode={impact.currencyCode} />
          ))}
        </div>
      )}
    </Card>
  )
}
