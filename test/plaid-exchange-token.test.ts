import test from 'node:test'
import assert from 'node:assert/strict'

import { mapPlaidType } from '@/app/api/plaid/exchange-token/route'

test('mapPlaidType maps depository savings correctly', () => {
  assert.equal(mapPlaidType('depository', 'savings'), 'savings')
})

test('mapPlaidType maps common plaid account types into supported values', () => {
  assert.equal(mapPlaidType('depository', 'checking'), 'checking')
  assert.equal(mapPlaidType('credit', null), 'credit')
  assert.equal(mapPlaidType('investment', null), 'investment')
  assert.equal(mapPlaidType('loan', null), 'other')
})
