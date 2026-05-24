import { Card } from '@/components/ui/Card'
import { ButtonLink } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/currency'
import type { MonthlyBudgetSummary } from '@/modules/budget/budget.types'
import { useI18n } from '@/i18n/client'

function getBudgetTone(summary: MonthlyBudgetSummary | null) {
  if (!summary || summary.totalPercentUsed === null) return 'neutral' as const
  if (summary.totalActualSpend > summary.totalBaseBudget) return 'danger' as const
  if (summary.totalPercentUsed >= 0.8) return 'warning' as const
  return 'success' as const
}

function getBudgetLabelKey(summary: MonthlyBudgetSummary | null) {
  const tone = getBudgetTone(summary)
  if (!summary || summary.totalBaseBudget <= 0) return 'dashboard.notConfigured'
  if (tone === 'danger') return 'dashboard.overBudget'
  if (tone === 'warning') return 'dashboard.watchClosely'
  return 'dashboard.safe'
}

export function BudgetHealthCard({ summary }: { summary: MonthlyBudgetSummary | null }) {
  const { t } = useI18n()
  const tone = getBudgetTone(summary)
  const risky = (summary?.categories ?? [])
    .filter((category) => category.status === 'over' || category.status === 'near')
    .sort((a, b) => (b.percentUsed ?? 0) - (a.percentUsed ?? 0))
    .slice(0, 3)

  return (
    <Card padding="none" className="dashboard-panel">
      <div className="card-header">
        <div>
          <h3>{t('dashboard.budgetHealth')}</h3>
          <p className="card-subtitle">{t('dashboard.budgetHealthSubtitle')}</p>
        </div>
        <Badge tone={tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : tone === 'danger' ? 'danger' : 'muted'}>
          {t(getBudgetLabelKey(summary))}
        </Badge>
      </div>
      <div style={{ padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {summary && summary.totalBaseBudget > 0 ? (
          <>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.55rem' }}>
                <span className="text-secondary">{t('dashboard.spent', { amount: formatCurrency(summary.totalActualSpend, summary.currencyCode) })}</span>
                <span className="text-secondary">{t('dashboard.planned', { amount: formatCurrency(summary.totalBaseBudget, summary.currencyCode) })}</span>
              </div>
              <ProgressBar value={summary.totalPercentUsed} tone={tone} label={t('dashboard.overallBudgetProgress')} />
            </div>
            <div className="budget-risk-list">
              {risky.length > 0 ? risky.map((category) => (
                <div className="budget-risk-row" key={category.categoryId}>
                  <div>
                    <strong>{category.categoryName}</strong>
                    <span style={{ display: 'block' }}>{t('dashboard.left', { amount: formatCurrency(category.remaining, summary.currencyCode) })}</span>
                  </div>
                  <Badge tone={category.status === 'over' ? 'danger' : 'warning'}>
                    {Math.round((category.percentUsed ?? 0) * 100)}%
                  </Badge>
                </div>
              )) : (
                <p className="text-secondary">{t('dashboard.noCategoriesNearLimit')}</p>
              )}
            </div>
          </>
        ) : (
          <div className="empty-copy text-secondary">{t('dashboard.setCategoryBudgets')}</div>
        )}
        <ButtonLink href="/budgets" variant="ghost" size="sm">{t('dashboard.manageBudgets')}</ButtonLink>
      </div>
    </Card>
  )
}
