import test from 'node:test'
import assert from 'node:assert/strict'

import {
  chunkTransactionsForGemini,
  parseClassificationResponseText,
  validateClassificationResponse,
  type RawTransactionToClassify,
} from '@/lib/gemini/classifier'
import { DEFAULT_GEMINI_MODEL } from '@/lib/gemini/config'

const sampleTransactions: RawTransactionToClassify[] = [
  {
    id: 'tx_1',
    merchant_name: 'SQ *APPLE STORE',
    description: 'SQ *APPLE STORE',
    amount: 12.5,
  },
  {
    id: 'tx_2',
    merchant_name: null,
    description: 'PAYROLL ACME',
    amount: -1200,
  },
]

test('validateClassificationResponse accepts a complete valid payload', () => {
  const parsed = validateClassificationResponse(
    [
      {
        id: 'tx_1',
        clean_merchant_name: 'Apple Store',
        category: {
          name: 'Shopping',
          name_zh: '购物消费',
          icon: '🛍️',
          type: 'expense',
        },
      },
      {
        id: 'tx_2',
        clean_merchant_name: 'Acme Payroll',
        category: {
          name: 'Income',
          type: 'income',
        },
      },
    ],
    sampleTransactions
  )

  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].clean_merchant_name, 'Apple Store')
  assert.equal(parsed[1].category.type, 'income')
})

test('validateClassificationResponse rejects missing items', () => {
  assert.throws(() =>
    validateClassificationResponse(
      [
        {
          id: 'tx_1',
          clean_merchant_name: 'Apple Store',
          category: { name: 'Shopping', type: 'expense' },
        },
      ],
      sampleTransactions
    )
  )
})

test('validateClassificationResponse rejects unknown or duplicate ids', () => {
  assert.throws(() =>
    validateClassificationResponse(
      [
        {
          id: 'tx_1',
          clean_merchant_name: 'Apple Store',
          category: { name: 'Shopping', type: 'expense' },
        },
        {
          id: 'tx_1',
          clean_merchant_name: 'Duplicate',
          category: { name: 'Income', type: 'income' },
        },
      ],
      sampleTransactions
    )
  )

  assert.throws(() =>
    validateClassificationResponse(
      [
        {
          id: 'tx_1',
          clean_merchant_name: 'Apple Store',
          category: { name: 'Shopping', type: 'expense' },
        },
        {
          id: 'tx_999',
          clean_merchant_name: 'Unknown',
          category: { name: 'Income', type: 'income' },
        },
      ],
      sampleTransactions
    )
  )
})

test('parseClassificationResponseText accepts fenced JSON with trailing notes', () => {
  const parsed = parseClassificationResponseText(`\`\`\`json
[
  {
    "id": "tx_1",
    "clean_merchant_name": "Apple Store",
    "category": {
      "name": "Shopping",
      "type": "expense"
    }
  },
  {
    "id": "tx_2",
    "clean_merchant_name": "Acme Payroll",
    "category": {
      "name": "Income",
      "type": "income"
    }
  }
]
\`\`\`
These classifications use your existing categories where possible.`)

  assert.ok(Array.isArray(parsed))
  assert.equal(parsed.length, 2)
  assert.deepEqual((parsed as Array<{ id: string }>).map((item) => item.id), [
    'tx_1',
    'tx_2',
  ])
})

test('parseClassificationResponseText accepts raw JSON with trailing explanation', () => {
  const parsed = parseClassificationResponseText(`[
  {
    "id": "tx_1",
    "clean_merchant_name": "Apple Store",
    "category": {
      "name": "Shopping",
      "type": "expense"
    }
  }
]
Classification completed successfully.`)

  assert.ok(Array.isArray(parsed))
  assert.equal(parsed.length, 1)
  assert.equal((parsed as Array<{ id: string }>)[0].id, 'tx_1')
})

test('default Gemini model uses Flash Lite requested for quota-sensitive work', () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.1-flash-lite')
})

test('chunkTransactionsForGemini respects batch size limit', () => {
  const transactions = Array.from({ length: 5 }, (_, index) => ({
    id: `tx_${index}`,
    merchant_name: `Merchant ${index}`,
    description: `Merchant ${index}`,
    amount: index + 1,
  }))

  const chunks = chunkTransactionsForGemini(transactions, [], {
    batchSize: 2,
    maxInputTokens: 250_000,
  })

  assert.deepEqual(
    chunks.map((chunk) => chunk.map((tx) => tx.id)),
    [['tx_0', 'tx_1'], ['tx_2', 'tx_3'], ['tx_4']]
  )
})
