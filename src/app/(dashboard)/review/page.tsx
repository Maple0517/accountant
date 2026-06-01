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
import { getTransactionBadgeParts } from '@/lib/transactions/badges'
import { needsRefundReview, needsTransferReview } from '@/lib/transactions/review'
import type { Category, Transaction } from '@/types'
import { useI18n } from '@/i18n/client'

type ReviewTransaction = Transaction & {
  categories?: Pick<Category, 'id' | 'name' | 'name_zh' | 'icon' | 'color'> | null
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

type ReviewIssue = {
  key: string
  label: string
  tone: 'accent' | 'warning' | 'info' | 'danger' | 'muted'
}

const fetcher = async (url: string): Promise<TransactionsApiResponse> => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to load review inbox')
  return json
}

function getIssueBuckets(tx: ReviewTransaction, t: (key: string) => string) {
  const tags = Array.isArray(tx.tags) ? tx.tags : []
  const issues: ReviewIssue[] = []

  if (tags.includes(AI_PENDING_TAG) || tags.includes(PLAID_FALLBACK_TAG)) {
    issues.push({ key: 'ai', label: t('transactions.aiPending'), tone: 'accent' })
  }
  if (!tx.category_id) {
    issues.push({ key: 'uncategorized', label: t('common.uncategorized'), tone: 'warning' })
  }
  if (needsRefundReview(tx)) {
    issues.push({ key: 'refund', label: t('review.refundReview'), tone: 'info' })
  }
  if (needsTransferReview(tx)) {
    issues.push({ key: 'transfer', label: t('review.transferMatch'), tone: 'danger' })
  }

  return issues
}

function getIssueSummaryLabel(
  counts: {
    ai: number
    uncategorized: number
    refunds: number
    transfers: number
  },
  t: (key: string) => string
) {
  return [
    counts.uncategorized > 0 ? `${counts.uncategorized} ${t('common.uncategorized')}` : null,
    counts.ai > 0 ? `${counts.ai} ${t('transactions.aiPending')}` : null,
    counts.transfers > 0 ? `${counts.transfers} ${t('review.transfers')}` : null,
    counts.refunds > 0 ? `${counts.refunds} ${t('review.refunds')}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export default function ReviewPage() {
  const { categoryName, t } = useI18n()
  const { data, error, isLoading } = useSWR(
    '/api/transactions?limit=100&offset=0&sourceOrAccount=all&category=all&currency=all&savedView=needs_review&includeViewCounts=true',
    fetcher
  )
  const reviewItems = data?.transactions ?? []
  const counts = reviewItems.reduce(
    (
      next: {
        ai: number
        uncategorized: number
        refunds: number
        transfers: number
      },
      tx: ReviewTransaction
    ) => {
      for (const issue of getIssueBuckets(tx, t)) {
        if (issue.key === 'ai') next.ai += 1
        if (issue.key === 'uncategorized') next.uncategorized += 1
        if (issue.key === 'refund') next.refunds += 1
        if (issue.key === 'transfer') next.transfers += 1
      }
      return next
    },
    { ai: 0, uncategorized: 0, refunds: 0, transfers: 0 }
  )
  const queueTotal =
    data?.totalCount ??
    counts.ai + counts.uncategorized + counts.refunds + counts.transfers
  const bucketSummary = getIssueSummaryLabel(counts, t)

  return (
    <div className="review-page">
      <PageHeader
        title={t('review.title')}
        subtitle={t('review.subtitle')}
        actions={
          <Link className="btn btn-ghost btn-sm" href="/transactions?savedView=needs_review">
            {t('review.openTransactions')}
          </Link>
        }
      />

      <Card padding="lg">
        <div className="card-header">
          <div>
            <h3>{t('review.queue')}</h3>
            <p className="card-subtitle">
              {queueTotal} {t('transactions.needsReview')}
              {bucketSummary ? ` · ${bucketSummary}` : ''}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="metric-value">{queueTotal}</div>
            <div className="metric-label">{t('transactions.needsReview')}</div>
          </div>
        </div>

        <div className="transactions-summary-grid">
          <Card padding="sm">
            <span className="metric-label">{t('common.uncategorized')}</span>
            <span className="metric-value">{counts.uncategorized}</span>
          </Card>
          <Card padding="sm">
            <span className="metric-label">{t('transactions.aiPending')}</span>
            <span className="metric-value">{counts.ai}</span>
          </Card>
          <Card padding="sm">
            <span className="metric-label">{t('review.transfers')}</span>
            <span className="metric-value">{counts.transfers}</span>
          </Card>
          <Card padding="sm">
            <span className="metric-label">{t('review.refunds')}</span>
            <span className="metric-value">{counts.refunds}</span>
          </Card>
        </div>
      </Card>

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
                {t('review.queueSubtitle', {
                  shown: reviewItems.length,
                  total: data?.totalCount ?? reviewItems.length,
                })}
              </p>
            </div>
          </div>
          <div className="transaction-list">
            {reviewItems.map((tx) => {
              const merchant = tx.merchant_name || tx.description || t('common.unknown')
              const account =
                tx.accounts?.plaid_items?.institution_name || tx.accounts?.name || tx.source
              const amount = Number(tx.amount)
              const categoryLabel = categoryName(tx.categories)
              const primaryHref = `/transactions?tx=${encodeURIComponent(
                tx.id
              )}&savedView=needs_review`
              return (
                <Link key={tx.id} href={primaryHref} className="tx-item tx-item-link review-inbox-item">
                  <div className="tx-icon">{tx.categories?.icon || '•'}</div>
                  <div className="tx-details">
                    <div className="tx-merchant-row">
                      <span className="tx-merchant">{merchant}</span>
                    </div>
                    <span className="tx-category">
                      {account} · {tx.date} · {categoryLabel}
                    </span>
                    <span className="tx-badges">
                      {getTransactionBadgeParts(tx, t).map((badge) => (
                        <Badge key={`${tx.id}-${badge.label}`} tone={badge.tone}>
                          {badge.label}
                        </Badge>
                      ))}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', flexDirection: 'column', gap: '0.35rem' }}>
                    <span className={`tx-amount ${amount < 0 ? 'income' : 'expense'}`}>
                      {formatCurrency(-amount, tx.iso_currency_code || 'USD')}
                    </span>
                    <span className="badge badge-muted">{t('review.openTransactions')}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
