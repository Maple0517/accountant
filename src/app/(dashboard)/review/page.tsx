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
import { useI18n } from '@/i18n/client'

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

function getIssues(tx: ReviewTransaction, t: (key: string) => string) {
  const tags = Array.isArray(tx.tags) ? tx.tags : []
  const issues: Array<{ label: string; tone: 'accent' | 'warning' | 'info' | 'danger' | 'muted' }> = []
  if (tags.includes(AI_PENDING_TAG) || tags.includes(PLAID_FALLBACK_TAG)) issues.push({ label: t('transactions.aiPending'), tone: 'accent' })
  if (!tx.category_id) issues.push({ label: t('common.uncategorized'), tone: 'warning' })
  if (tx.transaction_kind === 'refund' || tx.transaction_kind === 'reimbursement') issues.push({ label: t('review.refundReview'), tone: 'info' })
  if (tx.transaction_kind === 'transfer' && (!tx.transfer_match_status || tx.transfer_match_status === 'unmatched' || tx.transfer_match_status === 'suggested')) issues.push({ label: t('review.transferMatch'), tone: 'danger' })
  if (tx.pending) issues.push({ label: t('common.pending'), tone: 'muted' })
  return issues
}

export default function ReviewPage() {
  const { categoryName, t } = useI18n()
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
        title={t('review.title')}
        subtitle={t('review.subtitle')}
        actions={<Link className="btn btn-ghost btn-sm" href="/transactions">{t('review.openTransactions')}</Link>}
      />

      <div className="transactions-summary-grid">
        <Card padding="sm"><span className="metric-label">{t('transactions.aiPending')}</span><span className="metric-value">{counts.ai}</span></Card>
        <Card padding="sm"><span className="metric-label">{t('common.uncategorized')}</span><span className="metric-value">{counts.uncategorized}</span></Card>
        <Card padding="sm"><span className="metric-label">{t('review.refunds')}</span><span className="metric-value">{counts.refunds}</span></Card>
        <Card padding="sm"><span className="metric-label">{t('review.transfers')}</span><span className="metric-value">{counts.transfers}</span></Card>
        <Card padding="sm"><span className="metric-label">{t('common.pending')}</span><span className="metric-value">{counts.pending}</span></Card>
      </div>

      {isLoading && <div className="skeleton-card" />}
      {error && <div className="alert alert-error">{error.message}</div>}

      {!isLoading && !error && reviewItems.length === 0 && (
        <EmptyState title={t('review.emptyTitle')}>{t('review.emptyCopy')}</EmptyState>
      )}

      {reviewItems.length > 0 && (
        <Card padding="none">
          <div className="card-header">
            <div>
              <h3>{t('review.queue')}</h3>
              <p className="card-subtitle">
                {t('review.queueSubtitle', { shown: reviewItems.length, total: data?.totalCount ?? reviewItems.length })}
              </p>
            </div>
          </div>
          <div className="transaction-list">
            {reviewItems.map((tx) => {
              const merchant = tx.merchant_name || tx.description || t('common.unknown')
              const account = tx.accounts?.plaid_items?.institution_name || tx.accounts?.name || tx.source
              const amount = Number(tx.amount)
              return (
                <Link key={tx.id} href="/transactions" className="tx-item" style={{ textDecoration: 'none' }}>
                  <div className="tx-icon">{tx.categories?.icon || '•'}</div>
                  <div className="tx-details">
                    <span className="tx-merchant">{merchant}</span>
                    <span className="tx-category">{account} · {tx.date} · {categoryName(tx.categories)}</span>
                    <span className="tx-badges">{getIssues(tx, t).map((issue) => <Badge key={issue.label} tone={issue.tone}>{issue.label}</Badge>)}</span>
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
