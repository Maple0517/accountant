import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertValidParsedReceipt,
  ReceiptParsingValidationError,
  type ParsedReceipt,
} from '@/lib/gemini/receipt-parser'

const validReceipt: ParsedReceipt = {
  capture_type: 'receipt',
  transaction_type: 'expense',
  store_name: 'Coffee Shop',
  description: 'Coffee',
  date: '2026-05-20',
  items: [],
  total_amount: 4.5,
  currency: 'USD',
  payment_method: 'card',
  confidence_score: 0.9,
}

test('receipt parser validation accepts a valid ISO date and positive amount', () => {
  const receipt = { ...validReceipt }
  assert.equal(assertValidParsedReceipt(receipt), receipt)
})

test('receipt parser validation rejects bad dates before transaction creation', () => {
  assert.throws(
    () => assertValidParsedReceipt({ ...validReceipt, date: '05/20/2026' }),
    ReceiptParsingValidationError
  )
  assert.throws(
    () => assertValidParsedReceipt({ ...validReceipt, date: '2026-02-31' }),
    ReceiptParsingValidationError
  )
})

test('receipt parser validation rejects zero or invalid amounts', () => {
  assert.throws(
    () => assertValidParsedReceipt({ ...validReceipt, total_amount: 0 }),
    ReceiptParsingValidationError
  )
  assert.throws(
    () => assertValidParsedReceipt({ ...validReceipt, total_amount: Number.NaN }),
    ReceiptParsingValidationError
  )
})
