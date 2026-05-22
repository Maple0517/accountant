import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AI_CLASSIFIED_TAG,
  AI_PENDING_TAG,
  getPlaidPrimaryCategory,
  mergeClassificationTags,
  mergeTransactionClassification,
  PLAID_FALLBACK_TAG,
  shouldRefreshAiClassification,
} from '@/lib/plaid/classification'
import { getCategoryFromPlaid } from '@/lib/categories'
import {
  findLikelyOriginalPurchase,
  isLikelyRefundCandidate,
} from '@/lib/transactions/refund-matching'

test('mergeTransactionClassification preserves existing category when AI classification is absent', () => {
  const merged = mergeTransactionClassification(
    {
      category_id: 'cat_existing',
      merchant_name: 'Existing Merchant',
      tags: null,
    },
    {
      merchant_name: 'Plaid Merchant',
      name: 'RAW PLAID DESCRIPTION',
    }
  )

  assert.deepEqual(merged, {
    categoryId: 'cat_existing',
    cleanName: 'Existing Merchant',
    tags: [],
  })
})

test('mergeTransactionClassification preserves stable existing category over AI', () => {
  const merged = mergeTransactionClassification(
    {
      category_id: 'cat_existing',
      merchant_name: 'Existing Merchant',
      tags: null,
    },
    {
      merchant_name: 'Plaid Merchant',
      name: 'RAW PLAID DESCRIPTION',
    },
    {
      clean_merchant_name: 'Apple Store',
      category: { id: 'cat_ai' },
    }
  )

  assert.deepEqual(merged, {
    categoryId: 'cat_existing',
    cleanName: 'Apple Store',
    tags: [],
  })
})

test('mergeTransactionClassification upgrades pending Plaid fallback with AI category', () => {
  const merged = mergeTransactionClassification(
    {
      category_id: 'cat_plaid',
      merchant_name: 'Existing Merchant',
      tags: [PLAID_FALLBACK_TAG, AI_PENDING_TAG],
    },
    {
      merchant_name: 'Plaid Merchant',
      name: 'RAW PLAID DESCRIPTION',
    },
    {
      clean_merchant_name: 'Apple Store',
      category: { id: 'cat_ai' },
    }
  )

  assert.deepEqual(merged, {
    categoryId: 'cat_ai',
    cleanName: 'Apple Store',
    tags: [AI_CLASSIFIED_TAG],
  })
})

test('mergeTransactionClassification keeps existing category while still accepting AI cleaned name', () => {
  const merged = mergeTransactionClassification(
    {
      category_id: 'cat_existing',
      merchant_name: 'Old Merchant',
      tags: null,
    },
    {
      merchant_name: 'Plaid Merchant',
      name: 'RAW PLAID DESCRIPTION',
    },
    {
      clean_merchant_name: 'New Merchant',
    }
  )

  assert.deepEqual(merged, {
    categoryId: 'cat_existing',
    cleanName: 'New Merchant',
    tags: [],
  })
})

test('mergeTransactionClassification falls back to Plaid category when existing and AI categories are absent', () => {
  const merged = mergeTransactionClassification(
    undefined,
    {
      merchant_name: 'Meituan',
      name: 'MEITUAN PLATFORM',
    },
    undefined,
    {
      category: { id: 'cat_plaid_food' },
    }
  )

  assert.deepEqual(merged, {
    categoryId: 'cat_plaid_food',
    cleanName: 'Meituan',
    tags: [PLAID_FALLBACK_TAG, AI_PENDING_TAG],
  })
})

test('mergeTransactionClassification preserves existing category over Plaid fallback', () => {
  const merged = mergeTransactionClassification(
    {
      category_id: 'cat_existing',
      merchant_name: 'Existing Merchant',
      tags: null,
    },
    {
      merchant_name: 'Plaid Merchant',
      name: 'RAW PLAID DESCRIPTION',
    },
    undefined,
    {
      category: { id: 'cat_plaid_food' },
    }
  )

  assert.deepEqual(merged, {
    categoryId: 'cat_existing',
    cleanName: 'Existing Merchant',
    tags: [],
  })
})

test('mergeClassificationTags preserves user tags while marking fallback source', () => {
  assert.deepEqual(
    mergeClassificationTags(['travel-review'], 'plaid-fallback'),
    ['travel-review', PLAID_FALLBACK_TAG, AI_PENDING_TAG]
  )
})

test('shouldRefreshAiClassification targets uncategorized and pending fallback rows', () => {
  assert.equal(
    shouldRefreshAiClassification({ category_id: null, tags: [] }),
    true
  )
  assert.equal(
    shouldRefreshAiClassification({
      category_id: 'cat_plaid',
      tags: [PLAID_FALLBACK_TAG],
    }),
    true
  )
  assert.equal(
    shouldRefreshAiClassification({
      category_id: 'cat_stable',
      tags: [AI_CLASSIFIED_TAG],
    }),
    false
  )
})

test('getPlaidPrimaryCategory prefers personal finance category over legacy category', () => {
  assert.equal(
    getPlaidPrimaryCategory({
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_RESTAURANTS',
      },
      category: ['Shops'],
    }),
    'FOOD_AND_DRINK'
  )
})

test('getCategoryFromPlaid maps current Plaid personal finance categories', () => {
  assert.equal(getCategoryFromPlaid('GENERAL_MERCHANDISE').name, 'Shopping')
  assert.equal(getCategoryFromPlaid('Rent & Utilities').name, 'Bills & Utilities')
  assert.equal(getCategoryFromPlaid('TRANSFER_OUT').name, 'Transfer')
})

test('refund candidate detection accepts negative merchant credits and excludes income or transfer-like rows', () => {
  assert.equal(
    isLikelyRefundCandidate({
      amount: -50,
      merchant_name: 'Amazon',
      name: 'AMAZON MARKETPLACE REFUND',
      personal_finance_category: { primary: 'GENERAL_MERCHANDISE' },
    }),
    true
  )

  assert.equal(
    isLikelyRefundCandidate({
      amount: -3000,
      merchant_name: 'Employer',
      name: 'PAYROLL DIRECT DEPOSIT',
      personal_finance_category: {
        primary: 'INCOME',
        detailed: 'INCOME_WAGES',
      },
    }),
    false
  )

  assert.equal(
    isLikelyRefundCandidate({
      amount: -100,
      merchant_name: 'Bank',
      name: 'ONLINE TRANSFER',
      personal_finance_category: {
        primary: 'TRANSFER_IN',
        detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
      },
    }),
    false
  )
})

test('findLikelyOriginalPurchase links exact same-merchant refund to prior purchase', async () => {
  const candidates = [
    {
      id: 'purchase_1',
      account_id: 'account_1',
      category_id: 'cat_shopping',
      amount: 100,
      date: '2026-01-20',
      merchant_name: 'Amazon',
      description: 'AMAZON MARKETPLACE',
    },
  ]
  const supabase = {
    from() {
      const chain = {
        select() {
          return chain
        },
        eq() {
          return chain
        },
        gt() {
          return chain
        },
        lte() {
          return chain
        },
        gte() {
          return Promise.resolve({ data: candidates, error: null })
        },
      }

      return chain
    },
  }

  const match = await findLikelyOriginalPurchase({
    supabase: supabase as never,
    userId: 'user_1',
    accountId: 'account_1',
    refundAmountAbs: 100,
    merchantName: 'Amazon',
    refundDate: '2026-02-05',
  })

  assert.equal(match?.original.id, 'purchase_1')
  assert.equal(match?.original.category_id, 'cat_shopping')
  assert.equal(match?.confidence, 0.9)
})
