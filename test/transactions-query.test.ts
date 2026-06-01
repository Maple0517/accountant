import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTransactionsQueryParams } from '@/lib/transactions/query'

test('buildTransactionsQueryParams includes view counts in the bootstrap request', () => {
  const params = buildTransactionsQueryParams({
    limit: 50,
    offset: 0,
    sourceOrAccount: 'all',
    category: 'all',
    currency: 'all',
    savedView: 'needs_review',
    search: 'coffee',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30',
    tx: 'tx_123',
    includeViewCounts: true,
  })

  assert.equal(params.get('includeViewCounts'), 'true')
  assert.equal(params.get('savedView'), 'needs_review')
  assert.equal(params.get('search'), 'coffee')
  assert.equal(params.get('tx'), 'tx_123')
})

test('buildTransactionsQueryParams omits empty optional fields', () => {
  const params = buildTransactionsQueryParams({
    limit: 50,
    offset: 0,
    sourceOrAccount: 'all',
    category: 'all',
    currency: 'all',
    savedView: 'all',
    search: '',
    dateFrom: '',
    dateTo: '',
    tx: '',
    includeViewCounts: false,
  })

  assert.equal(params.get('includeViewCounts'), null)
  assert.equal(params.get('search'), null)
  assert.equal(params.get('tx'), null)
})
