import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getMonthlySemanticAmounts,
  getReviewCounts,
} from '@/features/dashboard/dashboard-utils'

test('dashboard monthly totals ignore excluded budget categories', () => {
  assert.deepEqual(
    getMonthlySemanticAmounts({
      amount: 3126,
      treatment: 'spending',
      categories: { is_excluded_from_budget: true },
    }),
    { spending: 0, income: 0 }
  )
})

test('dashboard review counts ignore pending-only and linked refunds', () => {
  assert.deepEqual(
    getReviewCounts([
      {
        amount: 25,
        date: '2026-05-01',
        pending: true,
        category_id: 'cat_1',
        treatment: 'spending',
        refund_source: null,
        tags: [],
      },
      {
        amount: -8,
        date: '2026-05-02',
        pending: false,
        category_id: 'cat_refunded',
        treatment: 'refund',
        refund_source: 'merchant_refund',
        linked_transaction_id: 'purchase_1',
        refund_match_confidence: 0.2,
        tags: [],
      },
    ]),
    {
      aiPending: 0,
      uncategorized: 0,
      possibleRefunds: 0,
      unmatchedTransfers: 0,
    }
  )
})
