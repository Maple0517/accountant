import { Card } from '@/components/ui/Card'
import { ButtonLink } from '@/components/ui/Button'

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
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const rows = [
    { label: 'AI pending', value: counts.aiPending, hint: 'Needs classifier confirmation' },
    { label: 'Uncategorized', value: counts.uncategorized, hint: 'Missing budget category' },
    { label: 'Refunds / reimbursements', value: counts.possibleRefunds, hint: 'Check linked purchase treatment' },
    { label: 'Unmatched transfers', value: counts.unmatchedTransfers, hint: 'Confirm transfer pairs' },
    { label: 'Pending', value: counts.pending, hint: 'Not posted yet' },
  ]

  return (
    <Card padding="none" className="dashboard-panel">
      <div className="card-header">
        <div>
          <h3>Needs Review</h3>
          <p className="card-subtitle">{total === 0 ? 'No obvious review items this month.' : `${total} item${total === 1 ? '' : 's'} need attention.`}</p>
        </div>
        <ButtonLink href="/review" variant="ghost" size="sm">Open inbox</ButtonLink>
      </div>
      <div className="review-list" style={{ padding: '1rem' }}>
        {rows.map((row) => (
          <div key={row.label} className="review-count-row">
            <div>
              <strong>{row.label}</strong>
              <span style={{ display: 'block' }}>{row.hint}</span>
            </div>
            <span className={`badge ${row.value > 0 ? 'badge-warning' : 'badge-muted'}`}>{row.value}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
