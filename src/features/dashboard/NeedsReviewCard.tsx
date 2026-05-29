import { Card } from '@/components/ui/Card'
import { ButtonLink } from '@/components/ui/Button'
import { useI18n } from '@/i18n/client'
import Link from 'next/link'

export function NeedsReviewCard({
  counts,
}: {
  counts: {
    aiPending: number
    uncategorized: number
    possibleRefunds: number
    unmatchedTransfers: number
    pending: number
  }
}) {
  const { t } = useI18n()
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const rows = [
    { label: t('transactions.aiPending'), value: counts.aiPending, hint: t('dashboard.aiPendingHint'), href: '/transactions?savedView=ai_pending' },
    { label: t('common.uncategorized'), value: counts.uncategorized, hint: t('dashboard.uncategorizedHint'), href: '/transactions?savedView=uncategorized' },
    { label: t('dashboard.refundsLabel'), value: counts.possibleRefunds, hint: t('dashboard.refundsHint'), href: '/transactions?savedView=refunds' },
    { label: t('dashboard.transfersLabel'), value: counts.unmatchedTransfers, hint: t('dashboard.transfersHint'), href: '/transactions?savedView=transfers' },
    { label: t('common.pending'), value: counts.pending, hint: t('dashboard.pendingHint'), href: '/transactions?savedView=pending' },
  ]

  return (
    <Card padding="none" className="dashboard-panel">
      <div className="card-header">
        <div>
          <h3>{t('dashboard.needsReview')}</h3>
          <p className="card-subtitle">{total === 0 ? t('dashboard.noReviewItems') : t('dashboard.itemsNeedAttention', { count: total, plural: total === 1 ? '' : 's' })}</p>
        </div>
        <ButtonLink href="/review" variant="ghost" size="sm">{t('dashboard.openInbox')}</ButtonLink>
      </div>
      <div className="review-list" style={{ padding: '1rem' }}>
        {rows.map((row) => (
          <Link key={row.label} className="review-count-row review-count-link" href={row.href}>
            <div>
              <strong>{row.label}</strong>
              <span style={{ display: 'block' }}>{row.hint}</span>
            </div>
            <span className={`badge ${row.value > 0 ? 'badge-warning' : 'badge-muted'}`}>{row.value}</span>
          </Link>
        ))}
      </div>
    </Card>
  )
}
