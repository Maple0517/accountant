import { MetricCard } from '@/components/ui/MetricCard'
import { formatCurrency } from '@/lib/currency'
import { useI18n } from '@/i18n/client'

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
  const { t } = useI18n()
  const netWorth = cash - cardDebt
  const savingsRate = monthlyIncome > 0 ? Math.max(0, (monthlyIncome - monthlySpending) / monthlyIncome) : null

  return (
    <div className="dashboard-snapshot-grid" aria-label={t('dashboard.netWorth')}>
      <MetricCard label={t('dashboard.netWorth')} value={formatCurrency(netWorth)} helper={t('dashboard.netWorthHelper')} tone={netWorth >= 0 ? 'positive' : 'negative'} />
      <MetricCard label={t('dashboard.cash')} value={formatCurrency(cash)} helper={t('dashboard.cashHelper')} tone="neutral" />
      <MetricCard label={t('dashboard.cardDebt')} value={formatCurrency(cardDebt)} helper={t('dashboard.cardDebtHelper')} tone={cardDebt > 0 ? 'negative' : 'neutral'} />
      <MetricCard label={t('dashboard.thisMonth')} value={formatCurrency(monthlySpending)} helper={savingsRate === null ? t('dashboard.noIncome') : t('dashboard.savingsRate', { rate: Math.round(savingsRate * 100) })} tone="warning" />
      <MetricCard label={t('dashboard.budgetLeft')} value={budgetLeft === null ? t('dashboard.notSet') : formatCurrency(budgetLeft)} helper={t('dashboard.budgetAware')} tone={budgetLeft === null ? 'neutral' : budgetLeft >= 0 ? 'positive' : 'negative'} />
    </div>
  )
}
