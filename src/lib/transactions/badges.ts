import { AI_PENDING_TAG, PLAID_FALLBACK_TAG } from '@/lib/plaid/classification'
import { needsRefundReview, needsTransferReview } from '@/lib/transactions/review'
import { deriveTransactionTreatment, normalizeTransactionSemantics } from '@/lib/transactions/treatment'
import type { Transaction } from '@/types'

export type TransactionBadgeTone =
  | 'accent'
  | 'success'
  | 'warning'
  | 'info'
  | 'muted'

export type TransactionBadge = {
  label: string
  tone: TransactionBadgeTone
}

type TransactionBadgeInput = Pick<
  Transaction,
  | 'amount'
  | 'category_id'
  | 'tags'
  | 'pending'
  | 'treatment'
  | 'refund_source'
  | 'linked_transaction_id'
  | 'refund_match_confidence'
  | 'refund_match_reason'
  | 'semantic_override_source'
  | 'transfer_match_status'
  | 'split_role'
  | 'split_sequence'
  | 'split_status'
>

export function hasTransactionNeedsReviewBadge(tx: TransactionBadgeInput) {
  const tags = Array.isArray(tx.tags) ? tx.tags : []
  const hasAutomaticClassificationTag =
    tags.includes(AI_PENDING_TAG) || tags.includes(PLAID_FALLBACK_TAG)

  return (
    !tx.category_id ||
    hasAutomaticClassificationTag ||
    needsRefundReview(tx) ||
    needsTransferReview(tx)
  )
}

export function getTransactionBadgeParts(
  tx: TransactionBadgeInput,
  t: (key: string, params?: Record<string, string | number>) => string
): TransactionBadge[] {
  const tags = Array.isArray(tx.tags) ? tx.tags : []
  const hasAutomaticClassificationTag =
    tags.includes(AI_PENDING_TAG) || tags.includes(PLAID_FALLBACK_TAG)
  const needsReviewBadge = hasTransactionNeedsReviewBadge(tx)
  const treatment = deriveTransactionTreatment({
    treatment: tx.treatment,
  })
  const refundSource = normalizeTransactionSemantics({
    treatment: tx.treatment,
    refundSource: tx.refund_source,
    amount: Number(tx.amount),
  }).refundSource

  const badges: TransactionBadge[] = []

  if (needsReviewBadge) {
    badges.push({ label: t('transactions.needsReview'), tone: 'warning' })
  } else if (hasAutomaticClassificationTag) {
    badges.push({ label: t('transactions.aiPending'), tone: 'accent' })
  }

  if (tx.pending) {
    badges.push({ label: t('common.pending'), tone: 'warning' })
  }

  if (treatment === 'refund') {
    badges.push({
      label:
        refundSource === 'reimbursement'
          ? t('common.reimbursement')
          : t('common.refund'),
      tone: 'success',
    })
  }

  if (treatment === 'transfer' && !needsReviewBadge) {
    badges.push({ label: t('common.transfer'), tone: 'info' })
  }

  if (tx.split_role === 'child') {
    badges.push({
      label: t('transactions.splitChildBadge', { index: tx.split_sequence || '' }).trim(),
      tone: 'accent',
    })
  }

  if (tx.split_status === 'out_of_balance') {
    badges.push({ label: t('transactions.splitOutOfBalance'), tone: 'warning' })
  }

  if (treatment === 'excluded') {
    badges.push({ label: t('common.excluded'), tone: 'muted' })
  }

  return badges
}
