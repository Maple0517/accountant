import test from 'node:test'
import assert from 'node:assert/strict'

import { createTransactionDatabase, syncSingleTransactionIfEnabled } from '@/lib/notion/sync'

test('syncSingleTransactionIfEnabled reports disabled Notion sync without throwing', async () => {
  const supabase = {
    from() {
      throw new Error('transactions should not be queried when sync is disabled')
    },
  }

  const result = await syncSingleTransactionIfEnabled('user_1', 'tx_1', {
    supabase: supabase as never,
    profile: { notion_sync_enabled: false },
  })

  assert.deepEqual(result, {
    transactionId: 'tx_1',
    status: 'disabled',
    synced: false,
    notionPageId: null,
  })
})

test('syncSingleTransactionIfEnabled reports missing token/database as not_configured', async () => {
  const supabase = {
    from() {
      throw new Error('transactions should not be queried when token/database is missing')
    },
  }

  const result = await syncSingleTransactionIfEnabled('user_1', 'tx_1', {
    supabase: supabase as never,
    profile: { notion_sync_enabled: true, notion_token: null, notion_database_id: null },
  })

  assert.equal(result.status, 'not_configured')
  assert.equal(result.synced, false)
  assert.equal(result.notionPageId, null)
  assert.match('error' in result ? result.error || '' : '', /token or database ID/)
})

test('createTransactionDatabase uses a plain number amount property', async () => {
  const previousFetch = globalThis.fetch
  const requests: Array<{ url: string; init?: RequestInit }> = []

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    return new Response(JSON.stringify({ id: 'db_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const databaseId = await createTransactionDatabase('page_123', 'secret_token')

    assert.equal(databaseId, 'db_123')
    assert.equal(requests.length, 1)

    const body = JSON.parse(requests[0].init?.body as string)
    assert.deepEqual(body.properties.Amount, { number: { format: 'number' } })
  } finally {
    globalThis.fetch = previousFetch
  }
})
