import test from 'node:test'
import assert from 'node:assert/strict'

import { isWebhookSecretValid } from '@/app/api/plaid/webhook/route'

function withWebhookSecret<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.PLAID_WEBHOOK_SECRET
  try {
    if (value === undefined) {
      delete process.env.PLAID_WEBHOOK_SECRET
    } else {
      process.env.PLAID_WEBHOOK_SECRET = value
    }
    return fn()
  } finally {
    if (previous === undefined) {
      delete process.env.PLAID_WEBHOOK_SECRET
    } else {
      process.env.PLAID_WEBHOOK_SECRET = previous
    }
  }
}

test('Plaid webhook secret fails closed when the env secret is missing', () => {
  withWebhookSecret(undefined, () => {
    const request = new Request('https://example.test/api/plaid/webhook', {
      headers: { 'x-plaid-webhook-secret': 'anything' },
    })

    assert.equal(isWebhookSecretValid(request), false)
  })
})

test('Plaid webhook secret only accepts the configured header value', () => {
  withWebhookSecret('expected-secret', () => {
    const valid = new Request('https://example.test/api/plaid/webhook', {
      headers: { 'x-plaid-webhook-secret': 'expected-secret' },
    })
    const invalid = new Request(
      'https://example.test/api/plaid/webhook?secret=expected-secret',
      { headers: { 'x-plaid-webhook-secret': 'wrong-secret' } }
    )
    const missingHeader = new Request(
      'https://example.test/api/plaid/webhook?secret=expected-secret'
    )

    assert.equal(isWebhookSecretValid(valid), true)
    assert.equal(isWebhookSecretValid(invalid), false)
    assert.equal(isWebhookSecretValid(missingHeader), false)
  })
})
