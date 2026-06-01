import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectTransferSemantics,
  type TransferAccountContext,
  type TransferMatchTransaction,
} from '@/lib/transactions/transfer-matching'

const checking: TransferAccountContext = {
  id: 'acct_checking',
  name: 'Everyday Checking',
  type: 'checking',
}

const savings: TransferAccountContext = {
  id: 'acct_savings',
  name: 'Savings',
  type: 'savings',
}

const credit: TransferAccountContext = {
  id: 'acct_credit',
  name: 'Chase Freedom',
  type: 'credit',
}

const investment: TransferAccountContext = {
  id: 'acct_investment',
  name: 'Brokerage',
  type: 'investment',
}

function makeTx(
  overrides: Partial<TransferMatchTransaction>
): TransferMatchTransaction {
  return {
    id: 'tx',
    accountId: checking.id,
    amount: 100,
    date: '2026-05-05',
    name: 'Transaction',
    merchantName: null,
    account: checking,
    ...overrides,
  }
}

test('matches credit card payment legs as excluded transfer', () => {
  const result = detectTransferSemantics(
    [
      makeTx({
        id: 'checking_payment',
        accountId: checking.id,
        account: checking,
        amount: 250,
        name: 'Online payment to Chase card',
      }),
      makeTx({
        id: 'credit_received',
        accountId: credit.id,
        account: credit,
        amount: -250,
        date: '2026-05-06',
        name: 'Payment received - thank you',
      }),
    ],
    () => 'group-1'
  )

  const checkingLeg = result.get('checking_payment')
  const creditLeg = result.get('credit_received')

  assert.equal(checkingLeg?.treatment, 'transfer')
  assert.equal(checkingLeg?.transferMatchStatus, 'auto_matched')
  assert.equal(checkingLeg?.transferGroupId, 'group-1')
  assert.equal(creditLeg?.transferGroupId, 'group-1')
  assert.equal(creditLeg?.treatment, 'transfer')
})

test('matches checking to savings transfer legs', () => {
  const result = detectTransferSemantics(
    [
      makeTx({
        id: 'checking_out',
        accountId: checking.id,
        account: checking,
        amount: 500,
        name: 'Online transfer to savings',
      }),
      makeTx({
        id: 'savings_in',
        accountId: savings.id,
        account: savings,
        amount: -500,
        date: '2026-05-07',
        name: 'Deposit from checking transfer',
      }),
    ],
    () => 'group-2'
  )

  assert.equal(result.get('checking_out')?.transferMatchStatus, 'auto_matched')
  assert.equal(result.get('savings_in')?.transferGroupId, 'group-2')
})

test('suggests medium-confidence transfer without changing budget treatment', () => {
  const result = detectTransferSemantics(
    [
      makeTx({
        id: 'checking_out',
        accountId: checking.id,
        account: checking,
        amount: 500,
        name: 'Transfer',
      }),
      makeTx({
        id: 'investment_in',
        accountId: investment.id,
        account: investment,
        amount: -500.5,
        date: '2026-05-09',
        name: 'Deposit',
      }),
    ],
    () => 'group-suggested'
  )

  const suggested = result.get('checking_out')

  assert.equal(suggested?.transferMatchStatus, 'suggested')
  assert.equal(suggested?.transferGroupId, 'group-suggested')
  assert.equal(suggested?.treatment, undefined)
  assert.equal(result.get('investment_in')?.transferMatchStatus, 'suggested')
})

test('marks strong single-sided credit card payment as unmatched transfer', () => {
  const result = detectTransferSemantics([
    makeTx({
      id: 'single_payment',
      accountId: checking.id,
      account: checking,
      amount: 300,
      name: 'Autopay credit card payment',
    }),
  ])

  const payment = result.get('single_payment')

  assert.equal(payment?.treatment, 'transfer')
  assert.equal(payment?.transferMatchStatus, 'unmatched')
  assert.equal(payment?.transferGroupId, null)
})

test('does not treat credit card interest or bank fees as transfer', () => {
  const result = detectTransferSemantics([
    makeTx({
      id: 'interest',
      accountId: credit.id,
      account: credit,
      amount: 42,
      name: 'Interest charge',
    }),
    makeTx({
      id: 'fee',
      accountId: checking.id,
      account: checking,
      amount: 5,
      name: 'ATM fee',
    }),
  ])

  assert.equal(result.has('interest'), false)
  assert.equal(result.has('fee'), false)
})

test('does not mark ordinary bill payment as single-sided transfer', () => {
  const result = detectTransferSemantics([
    makeTx({
      id: 'utility',
      amount: 125,
      name: 'Utility bill payment',
    }),
  ])

  assert.equal(result.has('utility'), false)
})
