'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCurrency } from '@/lib/currency'
import {
  AI_PENDING_TAG,
  PLAID_FALLBACK_TAG,
} from '@/lib/plaid/classification'
import type { Category, Transaction } from '@/types'

type ReviewTransaction = Transaction & {
  categories?: Pick<Category, 'name' | 'name_zh' | 'icon' | 'color'> | null
  accounts?: {
    name?: string | null
    mask?: string | null
    plaid_items?: { institution_name?: string | null } | null
  } | null
}

type TransactionsApiResponse = {
  transactions: ReviewTransaction[]
  totalCount: number
  viewCounts?: {
    ai_pending?: number
    uncategorized?: number
    refunds?: number
    transfers?: number
    pending?: number
  }
}

const fetcher = async (url: string): Promise<TransactionsApiResponse> => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to load review inbox')
  return json
}

function getIssues(tx: ReviewTransaction) {
  const tags = Array.isArray(tx.tags) ? tx.tags : []
  const issues: Array<{ label: string; tone: 'accent' | 'warning' | 'info' | 'danger' | 'muted' }> = []
  if (tags.includes(AI_PENDING_TAG) || tags.includes(PLAID_FALLBACK_TAG)) issues.push({ label: 'AI pending', tone: 'accent' })
  if (!tx.category_id) issues.push({ label: 'Uncategorized', tone: 'warning' })
  if (tx.transaction_kind === 'refund' || tx.transaction_kind === 'reimbursement') issues.push({ label: 'Refund review', tone: 'info' })
  if (tx.transaction_kind === 'transfer' && (!tx.transfer_match_status || tx.transfer_match_status === 'unmatched' || tx.transfer_match_status === 'suggested')) issues.push({ label: 'Transfer match', tone: 'danger' })
  if (tx.pending) issues.push({ label: 'Pending', tone: 'muted' })
  return issues
}

export default function ReviewPage() {
  const { data, error, isLoading } = useSWR('/api/transactions?limit=100&offset=0&sourceOrAccount=all&category=all&currency=all&savedView=needs_review', fetcher)
  const reviewItems = data?.transactions ?? []
  const counts = {
    ai: data?.viewCounts?.ai_pending ?? 0,
    uncategorized: data?.viewCounts?.uncategorized ?? 0,
    refunds: data?.viewCounts?.refunds ?? 0,
    transfers: data?.viewCounts?.transfers ?? 0,
    pending: data?.viewCounts?.pending ?? 0,
  }

  return (
    <div className="review-page">
      <PageHeader
        title="Review Inbox"
        subtitle="A focused list of transactions that need confirmation before they affect budgets and insights."
        actions={<Link className="btn btn-ghost btn-sm" href="/transactions">Open transactions</Link>}
      />

      <div className="transactions-summary-grid">
        <Card padding="sm"><span className="metric-label">AI pending</span><span className="metric-value">{counts.ai}</span></Card>
        <Card padding="sm"><span className="metric-label">Uncategorized</span><span className="metric-value">{counts.uncategorized}</span></Card>
        <Card padding="sm"><span className="metric-label">Refunds</span><span className="metric-value">{counts.refunds}</span></Card>
        <Card padding="sm"><span className="metric-label">Transfers</span><span className="metric-value">{counts.transfers}</span></Card>
        <Card padding="sm"><span className="metric-label">Pending</span><span className="metric-value">{counts.pending}</span></Card>
      </div>

      {isLoading && <div className="skeleton-card" />}
      {error && <div className="alert alert-error">{error.message}</div>}

      {!isLoading && !error && reviewItems.length === 0 && (
        <EmptyState title="Nothing needs review">Your current transaction set has no obvious AI, category, refund, transfer, or pending issues.</EmptyState>
      )}

      {reviewItems.length > 0 && (
        <Card padding="none">
          <div className="card-header">
            <div>
              <h3>Review queue</h3>
              <p className="card-subtitle">
                Showing {reviewItems.length} of {data?.totalCount ?? reviewItems.length}. Use the transaction detail tools to apply decisions.
              </p>
            </div>
          </div>
          <div className="transaction-list">
            {reviewItems.map((tx) => {
              const merchant = tx.merchant_name || tx.description || 'Unknown'
              const account = tx.accounts?.plaid_items?.institution_name || tx.accounts?.name || tx.source
              const amount = Number(tx.amount)
              return (
                <Link key={tx.id} href="/transactions" className="tx-item" style={{ textDecoration: 'none' }}>
                  <div className="tx-icon">{tx.categories?.icon || '•'}</div>
                  <div className="tx-details">
                    <span className="tx-merchant">{merchant}</span>
                    <span className="tx-category">{account} · {tx.date} · {tx.categories?.name_zh || tx.categories?.name || 'Uncategorized'}</span>
                    <span className="tx-badges">{getIssues(tx).map((issue) => <Badge key={issue.label} tone={issue.tone}>{issue.label}</Badge>)}</span>
                  </div>
                  <span className={`tx-amount ${amount < 0 ? 'income' : 'expense'}`}>{formatCurrency(-amount, tx.iso_currency_code || 'USD')}</span>
                </Link>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
