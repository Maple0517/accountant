import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createTransactionDatabase,
  enqueueNotionSyncOutbox,
  ensureNotionSplitSchemaReady,
  processNotionSyncOutbox,
  syncTransactionToNotion,
  syncSingleTransactionIfEnabled,
} from '@/lib/notion/sync'
import { resetNotionClient } from '@/lib/notion/client'

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
    assert.ok(
      body.properties.Source.select.options.some(
        (option: { name: string }) => option.name === 'split'
      )
    )
    assert.deepEqual(body.properties['Hidden From Reports'], { checkbox: {} })
    assert.deepEqual(body.properties['Bank Date'], { date: {} })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('split transaction Notion sync uses effective date and split metadata', async () => {
  const previousFetch = globalThis.fetch
  const requests: Array<{ url: string; init?: RequestInit }> = []
  resetNotionClient()

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    if (String(url).includes('/query')) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ id: 'page_split_child' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const pageId = await syncTransactionToNotion(
      {
        id: 'tx_child',
        user_id: 'user_1',
        account_id: 'account_1',
        amount: 25,
        date: '2026-05-20',
        budget_effective_date: '2026-06-01',
        effective_date: '2026-06-01',
        description: 'Split child',
        pending: false,
        source: 'split',
        split_role: 'child',
        split_group_id: 'group_1',
        split_parent_id: 'parent_1',
        split_sequence: 2,
        is_hidden_from_reports: false,
        created_at: '2026-05-20T00:00:00Z',
        updated_at: '2026-05-20T00:00:00Z',
      },
      'database_1',
      'secret_token'
    )

    assert.equal(pageId, 'page_split_child')
    const createRequest = requests.find((request) =>
      request.url.endsWith('/v1/pages')
    )
    assert.ok(createRequest)
    const body = JSON.parse(createRequest.init?.body as string)

    assert.equal(body.properties.Source.select.name, 'split')
    assert.equal(body.properties.Date.date.start, '2026-06-01')
    assert.equal(body.properties['Bank Date'].date.start, '2026-05-20')
    assert.equal(body.properties['Split Role'].select.name, 'child')
    assert.equal(body.properties['Split Group ID'].rich_text[0].text.content, 'group_1')
    assert.equal(body.properties['Split Parent ID'].rich_text[0].text.content, 'parent_1')
    assert.equal(body.properties['Split Sequence'].number, 2)
    assert.equal(body.properties['Hidden From Reports'].checkbox, false)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Notion semantic properties derive from canonical treatment when legacy fields are stale', async () => {
  const previousFetch = globalThis.fetch
  const requests: Array<{ url: string; init?: RequestInit }> = []
  resetNotionClient()

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    if (String(url).includes('/query')) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (String(url).includes('/v1/databases/')) {
      return new Response(
        JSON.stringify({ id: 'database_1', data_sources: [{ id: 'data_source_1' }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
    if (String(url).includes('/v1/data-sources/')) {
      return new Response(JSON.stringify({ id: 'data_source_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ id: 'page_income_1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const pageId = await syncTransactionToNotion(
      {
        id: 'tx_income',
        user_id: 'user_1',
        account_id: 'account_1',
        amount: -42,
        date: '2026-05-20',
        budget_effective_date: '2026-05-20',
        effective_date: '2026-05-20',
        description: 'Income tx',
        pending: false,
        source: 'manual',
        treatment: 'income',
        refund_source: null,
        is_hidden_from_reports: false,
        created_at: '2026-05-20T00:00:00Z',
        updated_at: '2026-05-20T00:00:00Z',
      },
      'database_1',
      'secret_token'
    )

    assert.equal(pageId, 'page_income_1')
    const createRequest = requests.find((request) =>
      request.url.endsWith('/v1/pages')
    )
    assert.ok(createRequest)
    const body = JSON.parse(createRequest.init?.body as string)

    assert.equal(body.properties.Kind.select.name, 'Income')
    assert.equal(body.properties['Budget Treatment'].select.name, 'Counts as Income')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('enqueueNotionSyncOutbox upserts idempotent jobs', async () => {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: 'outbox_1', error: null })
    },
  }

  const result = await enqueueNotionSyncOutbox(supabase as never, [
    {
      userId: 'user_1',
      transactionId: 'tx_1',
      splitGroupId: 'group_1',
      jobType: 'sync_split_group',
      idempotencyKey: 'split-group:group_1:version:1',
      availableAt: '2026-05-25T00:00:00Z',
    },
  ])

  assert.deepEqual(result, { enqueued: 1 })
  assert.deepEqual(rpcCalls, [
    {
      fn: 'enqueue_notion_sync_outbox',
      args: {
        p_user_id: 'user_1',
        p_transaction_id: 'tx_1',
        p_split_group_id: 'group_1',
        p_job_type: 'sync_split_group',
        p_idempotency_key: 'split-group:group_1:version:1',
        p_available_at: '2026-05-25T00:00:00Z',
      },
    },
  ])
})

test('ensureNotionSplitSchemaReady reports disabled and not-configured states without touching Notion', async () => {
  assert.deepEqual(
    await ensureNotionSplitSchemaReady('user_1', {
      supabase: {} as never,
      profile: { notion_sync_enabled: false },
    }),
    { ready: true, status: 'disabled' }
  )

  const notConfigured = await ensureNotionSplitSchemaReady('user_1', {
    supabase: {} as never,
    profile: {
      notion_sync_enabled: true,
      notion_token: null,
      notion_database_id: null,
    },
  })

  assert.equal(notConfigured.ready, false)
  assert.equal(notConfigured.status, 'not_configured')
})

test('processNotionSyncOutbox marks retryable failure when Notion schema is not configured', async () => {
  const updates: Array<Record<string, unknown>> = []
  const now = new Date('2026-05-25T00:00:00Z')
  const supabase = {
    from(table: string) {
      if (table === 'notion_sync_outbox') {
        return makeOutboxQuery(updates, [
          {
            id: 'job_1',
            user_id: 'user_1',
            transaction_id: 'tx_1',
            split_group_id: null,
            job_type: 'sync_effective_transaction',
            idempotency_key: 'transaction:tx_1:notion-sync:1',
            status: 'pending',
            attempts: 0,
            last_error: null,
            available_at: '2026-05-24T00:00:00Z',
            created_at: '2026-05-24T00:00:00Z',
            updated_at: '2026-05-24T00:00:00Z',
          },
        ])
      }

      if (table === 'profiles') {
        return makeSingleQuery({
          notion_sync_enabled: true,
          notion_token: null,
          notion_database_id: null,
        })
      }

      throw new Error(`Unexpected table ${table}`)
    },
  }

  const result = await processNotionSyncOutbox({
    supabase: supabase as never,
    now,
  })

  assert.equal(result.checked, 1)
  assert.equal(result.failed, 1)
  assert.equal(result.results[0].status, 'failed')
  assert.deepEqual(updates.map((update) => update.status), ['running', 'failed'])
  assert.equal(updates[1].attempts, 1)
  assert.match(String(updates[1].last_error), /token or database ID/)
})

function makeOutboxQuery(
  updates: Array<Record<string, unknown>>,
  rows: Array<Record<string, unknown>>
) {
  let updatePatch: Record<string, unknown> | null = null
  const query = {
    select() {
      return query
    },
    in() {
      return query
    },
    lte() {
      return query
    },
    order() {
      return query
    },
    limit() {
      return Promise.resolve({ data: rows, error: null })
    },
    update(patch: Record<string, unknown>) {
      updatePatch = patch
      updates.push(patch)
      return query
    },
    eq() {
      return query
    },
    then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      const data = updatePatch?.status === 'running' ? [{ id: 'job_1' }] : null
      return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected)
    },
  }

  return query
}

function makeSingleQuery(row: Record<string, unknown>) {
  const query = {
    select() {
      return query
    },
    eq() {
      return query
    },
    single() {
      return Promise.resolve({ data: row, error: null })
    },
  }

  return query
}
