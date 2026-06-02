import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MANUAL_REVIEWED_REFUND_REASON,
  needsRefundReview,
  needsTransactionReview,
  needsTransferReview,
} from '@/lib/transactions/review'

test('refund review only flags unlinked refund handling', () => {
  assert.equal(
    needsRefundReview({ treatment: 'refund', refund_source: 'merchant_refund', linked_transaction_id: null }),
    true
  )
  assert.equal(
    needsRefundReview({
      treatment: 'refund',
      refund_source: 'merchant_refund',
      linked_transaction_id: 'purchase_1',
      refund_match_confidence: 0.79,
      semantic_override_source: 'system',
    }),
    false
  )
  assert.equal(
    needsRefundReview({
      treatment: 'refund',
      refund_source: 'merchant_refund',
      linked_transaction_id: 'purchase_1',
      refund_match_confidence: 0.8,
      semantic_override_source: 'system',
    }),
    false
  )
  assert.equal(
    needsRefundReview({
      treatment: 'refund',
      refund_source: 'reimbursement',
      linked_transaction_id: null,
      refund_match_reason: MANUAL_REVIEWED_REFUND_REASON,
    }),
    false
  )
  assert.equal(
    needsRefundReview({
      treatment: 'refund',
      refund_source: 'merchant_refund',
      linked_transaction_id: null,
      semantic_override_source: 'user',
    }),
    true
  )
})

test('transaction review helper keeps other review reasons independent', () => {
  assert.equal(
    needsTransactionReview({
      pending: true,
      category_id: null,
      tags: ['classification:ai-pending'],
      treatment: 'transfer',
      transfer_match_status: 'suggested',
    }),
    false
  )
  assert.equal(
    needsTransactionReview({
      category_id: 'cat_1',
      tags: [],
      treatment: 'spending',
    }),
    false
  )
  assert.equal(
    needsTransactionReview({
      category_id: 'cat_1',
      tags: [],
      treatment: 'refund',
      refund_source: 'merchant_refund',
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
      treatment: 'refund',
      refund_source: 'merchant_refund',
      linked_transaction_id: 'purchase_1',
      refund_match_confidence: 0.9,
      semantic_override_source: 'system',
      transfer_match_status: null,
    }),
    false
  )
  assert.equal(
    needsTransferReview({ treatment: 'transfer', transfer_match_status: 'suggested' }),
    true
  )
  assert.equal(
    needsTransactionReview({
      category_id: 'cat_1',
      tags: [],
      treatment: 'transfer',
      transfer_match_status: 'suggested',
    }),
    true
  )
})
