import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MANUAL_REVIEWED_REFUND_REASON,
  needsRefundReview,
  needsTransactionReview,
  needsTransferReview,
} from '@/lib/transactions/review'

test('refund review only flags unconfirmed or low-confidence refund handling', () => {
  assert.equal(
    needsRefundReview({ transaction_kind: 'refund', linked_transaction_id: null }),
    true
  )
  assert.equal(
    needsRefundReview({
      transaction_kind: 'refund',
      linked_transaction_id: 'purchase_1',
      refund_match_confidence: 0.79,
      semantic_override_source: 'system',
    }),
    true
  )
  assert.equal(
    needsRefundReview({
      transaction_kind: 'refund',
      linked_transaction_id: 'purchase_1',
      refund_match_confidence: 0.8,
      semantic_override_source: 'system',
    }),
    false
  )
  assert.equal(
    needsRefundReview({
      transaction_kind: 'reimbursement',
      linked_transaction_id: null,
      refund_match_reason: MANUAL_REVIEWED_REFUND_REASON,
    }),
    false
  )
  assert.equal(
    needsRefundReview({
      transaction_kind: 'refund',
      linked_transaction_id: null,
      semantic_override_source: 'user',
    }),
    true
  )
})

test('transaction review helper keeps other review reasons independent', () => {
  assert.equal(
    needsTransactionReview({
      category_id: 'cat_1',
      tags: [],
      pending: false,
      transaction_kind: 'refund',
      linked_transaction_id: 'purchase_1',
      refund_match_confidence: 0.9,
      semantic_override_source: 'system',
    }),
    false
  )
  assert.equal(
    needsTransactionReview({
      category_id: 'cat_1',
      tags: [],
      pending: false,
      transaction_kind: 'refund',
      linked_transaction_id: 'purchase_1',
      refund_match_confidence: 0.9,
      semantic_override_source: 'system',
      transfer_match_status: null,
    }),
    false
  )
  assert.equal(
    needsTransferReview({ transaction_kind: 'transfer', transfer_match_status: 'suggested' }),
    true
  )
  assert.equal(
    needsTransactionReview({
      category_id: 'cat_1',
      tags: [],
      pending: false,
      transaction_kind: 'transfer',
      transfer_match_status: 'suggested',
    }),
    true
  )
})
