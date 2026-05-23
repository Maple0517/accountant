import test from 'node:test'
import assert from 'node:assert/strict'

import { syncSingleTransactionIfEnabled } from '@/lib/notion/sync'

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
