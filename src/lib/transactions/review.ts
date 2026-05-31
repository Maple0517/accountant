import { AI_PENDING_TAG, PLAID_FALLBACK_TAG } from '@/lib/plaid/classification'
import { deriveTransactionTreatment } from '@/lib/transactions/treatment'

export const REFUND_REVIEW_CONFIDENCE_THRESHOLD = 0.8
export const MANUAL_REVIEWED_REFUND_REASON = 'manual-reviewed'

type RefundReviewFields = {
  treatment?: string | null
  transaction_kind?: string | null
  linked_transaction_id?: string | null
  refund_match_confidence?: number | string | null
  semantic_override_source?: string | null
  refund_match_reason?: string | null
}

type TransactionReviewFields = RefundReviewFields & {
  category_id?: string | null
  tags?: string[] | null
  pending?: boolean | null
  transfer_match_status?: string | null
}

export function needsRefundReview(tx: RefundReviewFields) {
  if (
    deriveTransactionTreatment({
      treatment: tx.treatment,
      transactionKind: tx.transaction_kind,
    }) !== 'refund'
  ) {
    return false
  }

  if (tx.refund_match_reason === MANUAL_REVIEWED_REFUND_REASON) {
    return false
  }

  if (!tx.linked_transaction_id) {
    return true
  }

  const confidence = Number(tx.refund_match_confidence)
  if (!Number.isFinite(confidence) && tx.semantic_override_source === 'user') {
    return false
  }

  return (
    !Number.isFinite(confidence) ||
    confidence < REFUND_REVIEW_CONFIDENCE_THRESHOLD
  )
}

export function needsTransferReview(tx: {
  treatment?: string | null
  transaction_kind?: string | null
  budget_behavior?: string | null
  transfer_match_status?: string | null
}) {
  return (
    deriveTransactionTreatment({
      treatment: tx.treatment,
      transactionKind: tx.transaction_kind,
      budgetBehavior: tx.budget_behavior,
    }) === 'transfer' &&
    (!tx.transfer_match_status ||
      tx.transfer_match_status === 'unmatched' ||
      tx.transfer_match_status === 'suggested')
  )
}

export function needsTransactionReview(tx: TransactionReviewFields) {
  const tags = Array.isArray(tx.tags) ? tx.tags : []
  return (
    !tx.category_id ||
    tags.includes(AI_PENDING_TAG) ||
    tags.includes(PLAID_FALLBACK_TAG) ||
    tx.pending === true ||
    needsRefundReview(tx) ||
    needsTransferReview(tx)
  )
}
