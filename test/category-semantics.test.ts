import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveCategoryChangeSemantics } from '@/lib/transactions/category-semantics'

test('changing a transfer expense to an expense category resets it to spending', () => {
  const semantics = deriveCategoryChangeSemantics({
    amount: 1.47,
    treatment: 'transfer',
    category: {
      type: 'expense',
      is_excluded_from_budget: false,
    },
  })

  assert.deepEqual(semantics, {
    treatment: 'spending',
    refundSource: null,
  })
})

test('changing a credited transfer to an expense category resets it to income', () => {
  const semantics = deriveCategoryChangeSemantics({
    amount: -25,
    treatment: 'transfer',
    category: {
      type: 'expense',
      is_excluded_from_budget: false,
    },
  })

  assert.deepEqual(semantics, {
    treatment: 'income',
    refundSource: null,
  })
})

test('changing category preserves refund semantics', () => {
  const semantics = deriveCategoryChangeSemantics({
    amount: -12,
    treatment: 'refund',
    refundSource: 'merchant_refund',
    category: {
      type: 'expense',
      is_excluded_from_budget: false,
    },
  })

  assert.deepEqual(semantics, {
    treatment: 'refund',
    refundSource: 'merchant_refund',
  })
})

test('positive stored amount defaults to spending semantics', () => {
  const semantics = deriveCategoryChangeSemantics({
    amount: 1.47,
    category: {
      type: 'expense',
      is_excluded_from_budget: false,
    },
  })

  assert.deepEqual(semantics, {
    treatment: 'spending',
    refundSource: null,
  })
})

test('negative stored amount defaults to income semantics', () => {
  const semantics = deriveCategoryChangeSemantics({
    amount: -1.47,
    category: {
      type: 'expense',
      is_excluded_from_budget: false,
    },
  })

  assert.deepEqual(semantics, {
    treatment: 'income',
    refundSource: null,
  })
})
