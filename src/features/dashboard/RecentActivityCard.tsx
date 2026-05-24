import { Card } from '@/components/ui/Card'
import { ButtonLink } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/currency'
import type { DashboardRecentTransaction } from './types'
import { formatShortDate } from './dashboard-utils'

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function badgesFor(tx: DashboardRecentTransaction) {
  const tags = Array.isArray(tx.tags) ? tx.tags : []
  const badges: Array<{ label: string; tone: 'accent' | 'warning' | 'info' | 'muted' | 'danger' | 'success' }> = []
  if (tags.some((tag) => tag.includes('ai-pending') || tag.includes('plaid-fallback'))) badges.push({ label: 'AI Pending', tone: 'accent' })
  if (tx.pending) badges.push({ label: 'Pending', tone: 'warning' })
  if (tx.transaction_kind === 'refund') badges.push({ label: 'Refund', tone: 'success' })
  if (tx.transaction_kind === 'reimbursement') badges.push({ label: 'Reimbursement', tone: 'success' })
  if (tx.transaction_kind === 'transfer') badges.push({ label: 'Transfer', tone: 'info' })
  if (tx.budget_behavior === 'exclude_as_transfer' || tx.budget_behavior === 'exclude_manual') badges.push({ label: 'Excluded', tone: 'muted' })
  return badges.slice(0, 3)
}

export function RecentActivityCard({ transactions }: { transactions: DashboardRecentTransaction[] }) {
  return (
    <Card padding="none" className="dashboard-panel">
      <div className="card-header">
        <div>
          <h3>Recent Activity</h3>
          <p className="card-subtitle">Latest transactions with treatment badges</p>
        </div>
        <ButtonLink href="/transactions" variant="ghost" size="sm">View all</ButtonLink>
      </div>
      <div className="transaction-list">
        {transactions.length > 0 ? transactions.map((tx) => {
          const amount = Number(tx.amount)
          const isIncome = amount < 0
          const category = normalizeRelation(tx.categories)
          const account = normalizeRelation(tx.accounts)
          const merchant = tx.merchant_name || tx.description || 'Unknown'
          const label = account?.name ? `${account.name}${account.mask ? ` ••••${account.mask}` : ''}` : tx.source
          return (
            <div key={tx.id} className="tx-item">
              <div className="tx-icon">{category?.icon || '•'}</div>
              <div className="tx-details">
                <span className="tx-merchant">{merchant}</span>
                <span className="tx-category">{label} · {formatShortDate(tx.date)} · {category?.name_zh || category?.name || 'Uncategorized'}</span>
                <span className="tx-badges">
                  {badgesFor(tx).map((badge) => <Badge key={badge.label} tone={badge.tone}>{badge.label}</Badge>)}
                </span>
              </div>
              <span className={`tx-amount ${isIncome ? 'income' : 'expense'}`}>
                {formatCurrency(-amount)}
              </span>
            </div>
          )
        }) : (
          <div className="trend-empty">No recent transactions.</div>
        )}
      </div>
    </Card>
  )
}
