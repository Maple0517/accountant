import test from 'node:test'
import assert from 'node:assert/strict'

import { getNotionClient, resetNotionClient } from '@/lib/notion/client'

test('getNotionClient reuses clients only for the same token', () => {
  resetNotionClient()

  const tokenAClient = getNotionClient('secret_token_a')
  const sameTokenClient = getNotionClient('secret_token_a')
  const tokenBClient = getNotionClient('secret_token_b')

  assert.equal(tokenAClient, sameTokenClient)
  assert.notEqual(tokenAClient, tokenBClient)
})

test('getNotionClient uses the current default env token after reset', () => {
  resetNotionClient()
  const previousToken = process.env.NOTION_TOKEN

  try {
    process.env.NOTION_TOKEN = 'secret_default_a'
    const defaultClientA = getNotionClient()

    resetNotionClient()
    process.env.NOTION_TOKEN = 'secret_default_b'
    const defaultClientB = getNotionClient()

    assert.notEqual(defaultClientA, defaultClientB)
  } finally {
    if (previousToken === undefined) {
      delete process.env.NOTION_TOKEN
    } else {
      process.env.NOTION_TOKEN = previousToken
    }
    resetNotionClient()
  }
})
