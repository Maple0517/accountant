import { Card } from '@/components/ui/Card'
import { ButtonLink } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/currency'
import type { DashboardRecentTransaction } from './types'
import { formatShortDate } from './dashboard-utils'
import { useI18n } from '@/i18n/client'

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function badgesFor(tx: DashboardRecentTransaction, t: (key: string) => string) {
  const tags = Array.isArray(tx.tags) ? tx.tags : []
  const badges: Array<{ label: string; tone: 'accent' | 'warning' | 'info' | 'muted' | 'danger' | 'success' }> = []
  if (tags.some((tag) => tag.includes('ai-pending') || tag.includes('plaid-fallback'))) badges.push({ label: t('transactions.aiPending'), tone: 'accent' })
  if (tx.pending) badges.push({ label: t('common.pending'), tone: 'warning' })
  if (tx.transaction_kind === 'refund') badges.push({ label: t('common.refund'), tone: 'success' })
  if (tx.transaction_kind === 'reimbursement') badges.push({ label: t('common.reimbursement'), tone: 'success' })
  if (tx.transaction_kind === 'transfer') badges.push({ label: t('common.transfer'), tone: 'info' })
  if (tx.budget_behavior === 'exclude_as_transfer' || tx.budget_behavior === 'exclude_manual') badges.push({ label: t('common.excluded'), tone: 'muted' })
  return badges.slice(0, 3)
}

export function RecentActivityCard({ transactions }: { transactions: DashboardRecentTransaction[] }) {
  const { categoryName, t } = useI18n()

  return (
    <Card padding="none" className="dashboard-panel">
      <div className="card-header">
        <div>
          <h3>{t('dashboard.recentActivity')}</h3>
          <p className="card-subtitle">{t('dashboard.recentActivitySubtitle')}</p>
        </div>
        <ButtonLink href="/transactions" variant="ghost" size="sm">{t('dashboard.viewAll')}</ButtonLink>
      </div>
      <div className="transaction-list">
        {transactions.length > 0 ? transactions.map((tx) => {
          const amount = Number(tx.amount)
          const isIncome = amount < 0
          const category = normalizeRelation(tx.categories)
          const account = normalizeRelation(tx.accounts)
          const merchant = tx.merchant_name || tx.description || t('common.unknown')
          const label = account?.name ? `${account.name}${account.mask ? ` ••••${account.mask}` : ''}` : tx.source
          return (
            <div key={tx.id} className="tx-item">
              <div className="tx-icon">{category?.icon || '•'}</div>
              <div className="tx-details">
                <span className="tx-merchant">{merchant}</span>
                <span className="tx-category">{label} · {formatShortDate(tx.date)} · {categoryName(category)}</span>
                <span className="tx-badges">
                  {badgesFor(tx, t).map((badge) => <Badge key={badge.label} tone={badge.tone}>{badge.label}</Badge>)}
                </span>
              </div>
              <span className={`tx-amount ${isIncome ? 'income' : 'expense'}`}>
                {formatCurrency(-amount, tx.iso_currency_code || 'USD')}
              </span>
            </div>
          )
        }) : (
          <div className="trend-empty">{t('dashboard.noRecentTransactions')}</div>
        )}
      </div>
    </Card>
  )
}
