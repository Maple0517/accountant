import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPlaidLinkTokenConfig,
  parseLinkTokenRequestBody,
} from '@/app/api/plaid/create-link-token/route'

test('parseLinkTokenRequestBody defaults to create mode', () => {
  assert.deepEqual(parseLinkTokenRequestBody({}), {
    mode: 'create',
    plaidItemId: null,
  })
  assert.deepEqual(parseLinkTokenRequestBody({ mode: 'update_accounts', plaid_item_id: 'item_1' }), {
    mode: 'update_accounts',
    plaidItemId: 'item_1',
  })
  assert.equal(parseLinkTokenRequestBody({ mode: 'bad_mode' }), null)
})

test('buildPlaidLinkTokenConfig creates normal Link tokens with Transactions product', () => {
  const previousWebhook = process.env.PLAID_WEBHOOK_URL
  process.env.PLAID_WEBHOOK_URL = 'https://example.test/api/plaid/webhook'

  try {
    const config = buildPlaidLinkTokenConfig({ userId: 'user_1' })

    assert.deepEqual(config.user, { client_user_id: 'user_1' })
    assert.deepEqual(config.products, ['transactions'])
    assert.equal(config.webhook, 'https://example.test/api/plaid/webhook')
    assert.equal(config.access_token, undefined)
    assert.equal(config.update, undefined)
  } finally {
    if (previousWebhook === undefined) {
      delete process.env.PLAID_WEBHOOK_URL
    } else {
      process.env.PLAID_WEBHOOK_URL = previousWebhook
    }
  }
})

test('buildPlaidLinkTokenConfig creates update mode tokens for account selection', () => {
  const config = buildPlaidLinkTokenConfig({
    userId: 'user_1',
    accessToken: 'access-token-1',
  })

  assert.deepEqual(config.user, { client_user_id: 'user_1' })
  assert.equal(config.access_token, 'access-token-1')
  assert.deepEqual(config.update, { account_selection_enabled: true })
  assert.equal(config.products, undefined)
  assert.equal(config.webhook, undefined)
})
