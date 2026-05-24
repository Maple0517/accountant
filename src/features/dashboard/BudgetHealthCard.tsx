import { Card } from '@/components/ui/Card'
import { ButtonLink } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/currency'
import type { MonthlyBudgetSummary } from '@/modules/budget/budget.types'

function getBudgetTone(summary: MonthlyBudgetSummary | null) {
  if (!summary || summary.totalPercentUsed === null) return 'neutral' as const
  if (summary.totalActualSpend > summary.totalBaseBudget) return 'danger' as const
  if (summary.totalPercentUsed >= 0.8) return 'warning' as const
  return 'success' as const
}

function getBudgetLabel(summary: MonthlyBudgetSummary | null) {
  const tone = getBudgetTone(summary)
  if (!summary || summary.totalBaseBudget <= 0) return 'Not configured'
  if (tone === 'danger') return 'Over budget'
  if (tone === 'warning') return 'Watch closely'
  return 'Safe'
}

export function BudgetHealthCard({ summary }: { summary: MonthlyBudgetSummary | null }) {
  const tone = getBudgetTone(summary)
  const risky = (summary?.categories ?? [])
    .filter((category) => category.status === 'over' || category.status === 'near')
    .sort((a, b) => (b.percentUsed ?? 0) - (a.percentUsed ?? 0))
    .slice(0, 3)

  return (
    <Card padding="none" className="dashboard-panel">
      <div className="card-header">
        <div>
          <h3>Budget Health</h3>
          <p className="card-subtitle">Are you safe, close, or over?</p>
        </div>
        <Badge tone={tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : tone === 'danger' ? 'danger' : 'muted'}>
          {getBudgetLabel(summary)}
        </Badge>
      </div>
      <div style={{ padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {summary && summary.totalBaseBudget > 0 ? (
          <>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.55rem' }}>
                <span className="text-secondary">{formatCurrency(summary.totalActualSpend)} spent</span>
                <span className="text-secondary">{formatCurrency(summary.totalBaseBudget)} planned</span>
              </div>
              <ProgressBar value={summary.totalPercentUsed} tone={tone} label="Overall monthly budget progress" />
            </div>
            <div className="budget-risk-list">
              {risky.length > 0 ? risky.map((category) => (
                <div className="budget-risk-row" key={category.categoryId}>
                  <div>
                    <strong>{category.categoryName}</strong>
                    <span style={{ display: 'block' }}>{formatCurrency(category.remaining)} left</span>
                  </div>
                  <Badge tone={category.status === 'over' ? 'danger' : 'warning'}>
                    {Math.round((category.percentUsed ?? 0) * 100)}%
                  </Badge>
                </div>
              )) : (
                <p className="text-secondary">No categories are near their limit.</p>
              )}
            </div>
          </>
        ) : (
          <div className="empty-copy text-secondary">Set category budgets to unlock monthly safety signals.</div>
        )}
        <ButtonLink href="/budgets" variant="ghost" size="sm">Manage budgets</ButtonLink>
      </div>
    </Card>
  )
}
