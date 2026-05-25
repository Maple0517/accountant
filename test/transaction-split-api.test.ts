import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSplitNotionJobs,
  buildSplitPreview,
  decimalToMinor,
  mapSplitRpcError,
  normalizeSplitRequest,
  validateCanonicalSplitSigns,
} from '@/lib/transactions/split-api'

test('normalizeSplitRequest accepts decimal strings and normalizes optional blanks', () => {
  const result = normalizeSplitRequest({
    expected_version: 2,
    children: [
      {
        id: '',
        amount_decimal: '70.1000',
        category_id: '',
        allocation_date: '2026-05-01',
        transaction_kind: 'normal',
        budget_behavior: 'count_as_spending',
        linked_transaction_id: '',
        merchant_name: 'Groceries',
      },
      {
        amount_decimal: '29.9',
        category_id: null,
        transaction_kind: 'normal',
        budget_behavior: 'count_as_spending',
      },
    ],
  })

  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.deepEqual(result.value, {
    expected_version: 2,
    children: [
      {
        id: undefined,
        amount_decimal: '70.1',
        category_id: null,
        allocation_date: '2026-05-01',
        transaction_kind: 'normal',
        budget_behavior: 'count_as_spending',
        linked_transaction_id: null,
        merchant_name: 'Groceries',
        description: null,
        notes: null,
      },
      {
        id: undefined,
        amount_decimal: '29.9',
        category_id: null,
        allocation_date: null,
        transaction_kind: 'normal',
        budget_behavior: 'count_as_spending',
        linked_transaction_id: null,
        merchant_name: null,
        description: null,
        notes: null,
      },
    ],
  })
})

test('normalizeSplitRequest rejects malformed money', () => {
  const result = normalizeSplitRequest({
    children: [
      {
        amount_decimal: '10.12345',
        transaction_kind: 'normal',
        budget_behavior: 'count_as_spending',
      },
      {
        amount_decimal: '5',
        transaction_kind: 'normal',
        budget_behavior: 'count_as_spending',
      },
    ],
  })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error.code, 'INVALID_CHILD_AMOUNT')
  assert.equal(result.status, 422)
})

test('buildSplitPreview returns decimal-string balance and monthly impact', () => {
  const preview = buildSplitPreview(
    {
      amount: 100,
      date: '2026-05-10',
      budget_effective_date: null,
      effective_date: '2026-05-10',
      budget_behavior: 'count_as_spending',
    },
    [
      {
        amount_decimal: '60',
        category_id: '11111111-1111-1111-1111-111111111111',
        allocation_date: '2026-05-10',
        transaction_kind: 'normal',
        budget_behavior: 'count_as_spending',
      },
      {
        amount_decimal: '40',
        category_id: null,
        allocation_date: '2026-06-01',
        transaction_kind: 'normal',
        budget_behavior: 'count_as_spending',
      },
    ]
  )

  assert.equal(preview.balanced, true)
  assert.equal(preview.parentAmountDecimal, '100')
  assert.equal(preview.childAmountSumDecimal, '100')
  assert.equal(preview.remainingAmountDecimal, '0')
  assert.deepEqual(
    preview.budgetImpactByMonth.map((month) => ({
      month: month.month,
      net: month.netSpendingDeltaDecimal,
      income: month.incomeDeltaDecimal,
    })),
    [
      { month: '2026-05', net: '60', income: '0' },
      { month: '2026-06', net: '40', income: '0' },
    ]
  )
})

test('validateCanonicalSplitSigns rejects opposite-sign children', () => {
  assert.deepEqual(
    validateCanonicalSplitSigns('100', [
      {
        amount_decimal: '80',
        category_id: null,
        transaction_kind: 'normal',
        budget_behavior: 'count_as_spending',
      },
      {
        amount_decimal: '-20',
        category_id: null,
        transaction_kind: 'normal',
        budget_behavior: 'count_as_spending',
      },
    ]),
    ['children.1.amount_decimal has the wrong sign']
  )
})

test('mapSplitRpcError returns stable split error codes', () => {
  assert.equal(mapSplitRpcError({ message: 'Stale split version', code: '40001' }).body.code, 'STALE_VERSION')
  assert.equal(mapSplitRpcError({ message: 'Split children must balance to parent amount' }).body.code, 'UNBALANCED_SPLIT')
  assert.equal(mapSplitRpcError({ message: 'Pending transactions cannot be split in V1' }).body.code, 'PENDING_PARENT_NOT_SUPPORTED')
  assert.equal(mapSplitRpcError({ message: 'Invalid child reference' }).body.code, 'INVALID_CHILD_REFERENCE')
})

test('buildSplitNotionJobs creates durable idempotency keys', () => {
  const jobs = buildSplitNotionJobs({
    userId: 'user_1',
    parent: { id: 'parent_1' },
    group: { id: 'group_1', version: 3 },
    children: [{ id: 'child_1' }, { id: 'child_2' }],
    action: 'replace',
  })

  assert.deepEqual(
    jobs.map((job) => [job.jobType, job.idempotencyKey]),
    [
      ['mark_split_parent_hidden', 'split-parent-hidden:parent_1:version:3'],
      ['sync_split_group', 'split-group:group_1:version:3'],
      ['sync_effective_transaction', 'split-child-sync:child_1:group:group_1:version:3'],
      ['sync_effective_transaction', 'split-child-sync:child_2:group:group_1:version:3'],
    ]
  )
})

test('decimalToMinor preserves four decimal places exactly', () => {
  assert.equal(decimalToMinor('12.3456'), 123456)
  assert.equal(decimalToMinor('-0.0100'), -100)
})
