import { MetricCard } from '@/components/ui/MetricCard'
import { formatCurrency } from '@/lib/currency'

export function FinancialSnapshot({
  cash,
  cardDebt,
  monthlySpending,
  monthlyIncome,
  budgetLeft,
}: {
  cash: number
  cardDebt: number
  monthlySpending: number
  monthlyIncome: number
  budgetLeft: number | null
}) {
  const netWorth = cash - cardDebt
  const savingsRate = monthlyIncome > 0 ? Math.max(0, (monthlyIncome - monthlySpending) / monthlyIncome) : null

  return (
    <div className="dashboard-snapshot-grid" aria-label="Financial snapshot">
      <MetricCard label="Net worth" value={formatCurrency(netWorth)} helper="Cash minus card debt" tone={netWorth >= 0 ? 'positive' : 'negative'} />
      <MetricCard label="Cash" value={formatCurrency(cash)} helper="Checking, savings, cash" tone="neutral" />
      <MetricCard label="Card debt" value={formatCurrency(cardDebt)} helper="Credit balances" tone={cardDebt > 0 ? 'negative' : 'neutral'} />
      <MetricCard label="This month" value={formatCurrency(monthlySpending)} helper={savingsRate === null ? 'No income yet' : `${Math.round(savingsRate * 100)}% savings rate`} tone="warning" />
      <MetricCard label="Budget left" value={budgetLeft === null ? 'Not set' : formatCurrency(budgetLeft)} helper="Budget-aware spending" tone={budgetLeft === null ? 'neutral' : budgetLeft >= 0 ? 'positive' : 'negative'} />
    </div>
  )
}
