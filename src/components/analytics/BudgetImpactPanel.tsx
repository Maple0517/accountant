'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsBudgetImpactItem, AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

const STATUS_LABEL_KEYS: Record<AnalyticsBudgetImpactItem['status'], string> = {
  over: 'analytics.budgetStatusOver',
  at_risk: 'analytics.budgetStatusAtRisk',
  on_track: 'analytics.budgetStatusOnTrack',
  no_budget: 'analytics.budgetStatusNoBudget',
}

function BudgetImpactRow({ item, currencyCode }: { item: AnalyticsBudgetImpactItem; currencyCode: string }) {
  const { locale, t } = useI18n()
  const name = locale === 'zh' && item.categoryNameZh ? item.categoryNameZh : item.categoryName
  const remainingTone = item.remaining < 0 ? 'danger' : 'safe'

  return (
    <div className={`insights-budget-row ${item.status}`}>
      <div className="insights-budget-main">
        <Link href={item.transactionsHref} className="insights-budget-name">{name}</Link>
        <span className={`insights-budget-badge ${item.status}`}>{t(STATUS_LABEL_KEYS[item.status])}</span>
      </div>
      <div className="insights-budget-money">
        <span>{t('analytics.budgetActualOfPlan', {
          actual: formatCurrency(item.actualSpend, currencyCode),
          budget: item.baseBudget > 0 ? formatCurrency(item.baseBudget, currencyCode) : t('budgets.notConfigured'),
        })}</span>
        <strong className={remainingTone === 'danger' ? 'delta-positive' : 'delta-negative'}>
          {item.remaining < 0
            ? t('analytics.budgetOverBy', { amount: formatCurrency(Math.abs(item.remaining), currencyCode) })
            : t('analytics.budgetRemaining', { amount: formatCurrency(item.remaining, currencyCode) })}
        </strong>
      </div>
      <Link href={item.budgetHref} className="insights-action">{t('analytics.openBudget')}</Link>
    </div>
  )
}

function BudgetGroup({
  title,
  copy,
  items,
  currencyCode,
}: {
  title: string
  copy: string
  items: AnalyticsBudgetImpactItem[]
  currencyCode: string
}) {
  if (items.length === 0) return null

  return (
    <section className="insights-budget-group">
      <div className="insights-budget-group-header">
        <h4>{title}</h4>
        <p>{copy}</p>
      </div>
      <div className="insights-budget-list">
        {items.map((item) => (
          <BudgetImpactRow key={item.categoryId} item={item} currencyCode={currencyCode} />
        ))}
      </div>
    </section>
  )
}

export function BudgetImpactPanel({ data }: { data: AnalyticsData }) {
  const { t } = useI18n()
  const impact = data.budgetImpact

  if (!impact) {
    return (
      <Card padding="none" className="insights-panel insights-budget-panel refined">
        <div className="card-header">
          <div>
            <h3>{t('analytics.budgetImpact')}</h3>
            <p className="card-subtitle">{t('analytics.budgetImpactUnavailable')}</p>
          </div>
        </div>
      </Card>
    )
  }

  const allItems = [
    ...impact.groups.over,
    ...impact.groups.atRisk,
    ...impact.groups.noBudget,
    ...impact.groups.onTrack,
  ]
  const activeOnTrack = impact.groups.onTrack
    .filter((item) => item.actualSpend > 0)
    .sort((a, b) => b.actualSpend - a.actualSpend)
    .slice(0, 4)
  const riskCount = impact.groups.over.length + impact.groups.atRisk.length
  const totalSpend = allItems.reduce((sum, item) => sum + Math.max(0, item.actualSpend), 0)
  const totalBudget = allItems.reduce((sum, item) => sum + Math.max(0, item.baseBudget), 0)
  const percentUsed = totalBudget > 0 ? Math.min((totalSpend / totalBudget) * 100, 999) : null
  const progressWidth = percentUsed === null ? 0 : Math.min(percentUsed, 100)

  return (
    <Card padding="none" className="insights-panel insights-budget-panel refined">
      <div className="card-header insights-budget-header">
        <div>
          <h3>{t('analytics.budgetImpact')}</h3>
          <p className="card-subtitle">{t('analytics.budgetImpactSubtitle')}</p>
        </div>
        <span className={riskCount > 0 ? 'insights-risk-pill danger' : 'insights-risk-pill safe'}>
          {riskCount > 0
            ? t('analytics.budgetRiskCount', { count: riskCount })
            : t('analytics.budgetNoRisk')}
        </span>
      </div>

      <div className="insights-budget-summary">
        <div>
          <span>{t('analytics.budgetSpendAgainstPlan')}</span>
          <strong>{formatCurrency(totalSpend, impact.currencyCode)}</strong>
        </div>
        <div>
          <span>{t('analytics.budgetPlan')}</span>
          <strong>{totalBudget > 0 ? formatCurrency(totalBudget, impact.currencyCode) : t('budgets.notConfigured')}</strong>
        </div>
        <div>
          <span>{t('analytics.budgetUsed')}</span>
          <strong>{percentUsed === null ? t('budgets.notConfigured') : `${Math.round(percentUsed)}%`}</strong>
        </div>
      </div>
      <div className="insights-budget-progress" aria-hidden="true">
        <div style={{ width: `${progressWidth}%` }} />
      </div>

      {riskCount === 0 && activeOnTrack.length === 0 ? (
        <div className="insights-budget-calm-state">
          <strong>{t('analytics.budgetCalmTitle')}</strong>
          <p>{t('analytics.budgetCalmCopy')}</p>
        </div>
      ) : (
        <>
          <BudgetGroup
            title={t('analytics.budgetGroupAction')}
            copy={t('analytics.budgetGroupActionCopy')}
            items={impact.groups.over}
            currencyCode={impact.currencyCode}
          />
          <BudgetGroup
            title={t('analytics.budgetGroupWatch')}
            copy={t('analytics.budgetGroupWatchCopy')}
            items={impact.groups.atRisk}
            currencyCode={impact.currencyCode}
          />
          <BudgetGroup
            title={t('analytics.budgetGroupNoBudget')}
            copy={t('analytics.budgetGroupNoBudgetCopy')}
            items={impact.groups.noBudget}
            currencyCode={impact.currencyCode}
          />
          <BudgetGroup
            title={t('analytics.budgetGroupSafeActive')}
            copy={t('analytics.budgetGroupSafeActiveCopy')}
            items={activeOnTrack}
            currencyCode={impact.currencyCode}
          />
        </>
      )}
    </Card>
  )
}
