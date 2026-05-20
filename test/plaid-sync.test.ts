import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeTransactionClassification } from '@/app/api/plaid/sync-transactions/route'

test('mergeTransactionClassification preserves existing category when AI classification is absent', () => {
  const merged = mergeTransactionClassification(
    {
      category_id: 'cat_existing',
      merchant_name: 'Existing Merchant',
    },
    {
      merchant_name: 'Plaid Merchant',
      name: 'RAW PLAID DESCRIPTION',
    }
  )

  assert.deepEqual(merged, {
    categoryId: 'cat_existing',
    cleanName: 'Existing Merchant',
  })
})

test('mergeTransactionClassification uses AI category and cleaned name when available', () => {
  const merged = mergeTransactionClassification(
    {
      category_id: 'cat_existing',
      merchant_name: 'Existing Merchant',
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
  })
})

test('mergeTransactionClassification keeps existing category while still accepting AI cleaned name', () => {
  const merged = mergeTransactionClassification(
    {
      category_id: 'cat_existing',
      merchant_name: 'Old Merchant',
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
  })
})
