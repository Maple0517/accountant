import { getNotionClient } from './client'
import { Sema } from 'async-sema'
import type { Transaction } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UpdateDataSourceParameters } from '@notionhq/client'
import { getBudgetDate } from '@/lib/transactions/effective'
import { normalizeTransactionSemantics } from '@/lib/transactions/treatment'

// Rate limiter: ~3 requests per second
const rateLimiter = new Sema(1, { capacity: 3 })
const semanticsPropertiesEnsured = new Set<string>()

export type NotionSyncStatus =
  | { status: 'disabled' | 'not_configured'; synced: false; notionPageId: null; error?: string }
  | { status: 'synced'; synced: true; notionPageId: string }
  | { status: 'failed'; synced: false; notionPageId: null; error: string }

export type NotionProfileConfig = {
  notion_sync_enabled?: boolean | null
  notion_token?: string | null
  notion_database_id?: string | null
}

export type NotionSchemaReadiness =
  | { ready: true; status: 'disabled' | 'ready' }
  | { ready: false; status: 'not_configured' | 'schema_update_failed'; error: string }

export type NotionSyncOutboxRow = {
  id: string
  user_id: string
  transaction_id: string | null
  split_group_id: string | null
  job_type: NotionSyncOutboxJobType
  idempotency_key: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'dead'
  attempts: number
  last_error: string | null
  available_at: string
  created_at: string
  updated_at: string
}

export type ProcessNotionSyncOutboxResult = {
  checked: number
  processed: number
  succeeded: number
  failed: number
  dead: number
  skipped: number
  results: Array<{
    id: string
    jobType: NotionSyncOutboxJobType
    status: 'succeeded' | 'failed' | 'dead' | 'skipped'
    error?: string
  }>
}


const semanticPropertySchema: NonNullable<UpdateDataSourceParameters['properties']> = {
  Kind: {
    select: {
      options: [
        { name: 'Normal', color: 'default' },
        { name: 'Income', color: 'green' },
        { name: 'Refund', color: 'green' },
        { name: 'Reimbursement', color: 'blue' },
        { name: 'Transfer', color: 'gray' },
        { name: 'Excluded', color: 'yellow' },
      ],
    },
  },
  'Budget Treatment': {
    select: {
      options: [
        { name: 'Counts as Spending', color: 'red' },
        { name: 'Counts as Income', color: 'green' },
        { name: 'Excluded as Transfer', color: 'gray' },
        { name: 'Excluded Manually', color: 'yellow' },
      ],
    },
  },
  'Budget Date': { date: {} },
  'Linked Transaction': { rich_text: {} },
  'Transfer Group': { rich_text: {} },
  'Transfer Status': {
    select: {
      options: [
        { name: 'Matched', color: 'green' },
        { name: 'Suggested', color: 'yellow' },
        { name: 'Unmatched', color: 'orange' },
        { name: 'Ignored', color: 'gray' },
      ],
    },
  },
  'Match Confidence': { number: { format: 'percent' } },
  Reason: { rich_text: {} },
}

const splitPropertySchema: NonNullable<UpdateDataSourceParameters['properties']> = {
  Source: {
    select: {
      options: [
        { name: 'plaid', color: 'blue' },
        { name: 'manual', color: 'green' },
        { name: 'receipt', color: 'orange' },
        { name: 'split', color: 'purple' },
      ],
    },
  },
  'Split Role': {
    select: {
      options: [
        { name: 'none', color: 'default' },
        { name: 'parent', color: 'yellow' },
        { name: 'child', color: 'purple' },
      ],
    },
  },
  'Split Group ID': { rich_text: {} },
  'Split Parent ID': { rich_text: {} },
  'Split Sequence': { number: { format: 'number' } },
  'Hidden From Reports': { checkbox: {} },
  'Deleted At': { date: {} },
  'Deleted Reason': { rich_text: {} },
  'Bank Date': { date: {} },
  'Original Date': { date: {} },
}

const notionSchemaProperties: NonNullable<UpdateDataSourceParameters['properties']> = {
  ...semanticPropertySchema,
  ...splitPropertySchema,
}

export type NotionSyncOutboxJobType =
  | 'sync_effective_transaction'
  | 'mark_split_parent_hidden'
  | 'archive_or_mark_child_deleted'
  | 'sync_split_group'
  | 'restore_split_parent'

/**
 * Create the Notion database structure for transactions
 */
export async function createTransactionDatabase(
  parentPageId: string,
  notionToken?: string
): Promise<string> {
  const token = notionToken || process.env.NOTION_TOKEN;
  if (!token) throw new Error('No Notion token');

  const response = await fetch('https://api.notion.com/v1/databases', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: '💰 Transactions' } }],
      properties: {
        Name: { title: {} },
        Amount: { number: { format: 'number' } },
        Currency: {
          select: {
            options: [
              { name: 'USD', color: 'green' },
              { name: 'CNY', color: 'red' },
            ],
          },
        },
        Date: { date: {} },
        Category: {
          select: {
            options: [
              { name: '🍔 Food & Drink', color: 'orange' },
              { name: '🚗 Transportation', color: 'blue' },
              { name: '🛍️ Shopping', color: 'pink' },
              { name: '🎬 Entertainment', color: 'purple' },
              { name: '💡 Bills & Utilities', color: 'yellow' },
              { name: '💰 Income', color: 'green' },
              { name: '🔄 Transfer', color: 'gray' },
              { name: '🏥 Health', color: 'red' },
              { name: '📚 Education', color: 'blue' },
              { name: '✈️ Travel', color: 'purple' },
              { name: '📦 Other', color: 'default' },
            ],
          },
        },
        Account: { select: {} },
        Type: {
          select: {
            options: [
              { name: 'expense', color: 'red' },
              { name: 'income', color: 'green' },
              { name: 'transfer', color: 'gray' },
            ],
          },
        },
        'Payment Channel': {
          select: {
            options: [
              { name: 'online', color: 'blue' },
              { name: 'in store', color: 'green' },
              { name: 'other', color: 'gray' },
            ],
          },
        },
        Notes: { rich_text: {} },
        Source: {
          select: {
            options: [
              { name: 'plaid', color: 'blue' },
              { name: 'manual', color: 'green' },
              { name: 'receipt', color: 'orange' },
              { name: 'split', color: 'purple' },
            ],
          },
        },
        Tags: { multi_select: {} },
        'Transaction ID': { rich_text: {} },
        ...semanticPropertySchema,
        ...splitPropertySchema,
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error('Notion API Error:', data);
    throw new Error(`Failed to create Notion database: ${data.message || 'Unknown error'}`);
  }

  return data.id;
}

/**
 * Sync a single transaction to Notion
 */
export async function syncTransactionToNotion(
  transaction: Transaction & {
    category_name?: string
    account_name?: string
  },
  databaseId: string,
  notionToken?: string
): Promise<string | null> {
  await rateLimiter.acquire()

  try {
    const notion = getNotionClient(notionToken)
    const includeSemantics = await ensureTransactionSemanticsProperties(
      databaseId,
      notionToken
    )

    // Check if already synced (has notion_page_id)
    if (transaction.notion_page_id) {
      // Update existing page
      await notion.pages.update({
        page_id: transaction.notion_page_id,
        properties: buildNotionProperties(transaction, includeSemantics),
      })
      return transaction.notion_page_id
    }

    // Check for duplicate by transaction ID
    const existing = await findNotionPageByTransactionId(
      databaseId,
      transaction.id,
      notionToken
    )
    if (existing) {
      return existing
    }

    // Create new page
    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: buildNotionProperties(transaction, includeSemantics),
    })

    return response.id
  } catch (error) {
    console.error('Failed to sync transaction to Notion:', error)
    return null
  } finally {
    rateLimiter.release()
  }
}

/**
 * Batch sync multiple transactions to Notion
 */
export async function batchSyncToNotion(
  transactions: (Transaction & {
    category_name?: string
    account_name?: string
  })[],
  databaseId: string,
  notionToken?: string
): Promise<{
  synced: number
  failed: number
  results: Array<{ transactionId: string; notionPageId: string }>
}> {
  let synced = 0
  let failed = 0
  const results: Array<{ transactionId: string; notionPageId: string }> = []

  for (const transaction of transactions) {
    const pageId = await syncTransactionToNotion(
      transaction,
      databaseId,
      notionToken
    )

    if (pageId) {
      synced++
      results.push({ transactionId: transaction.id, notionPageId: pageId })
    } else {
      failed++
    }

    // Rate limit: ~350ms between requests
    await new Promise((resolve) => setTimeout(resolve, 350))
  }

  return { synced, failed, results }
}

async function ensureTransactionSemanticsProperties(
  databaseId: string,
  notionToken?: string
) {
  if (semanticsPropertiesEnsured.has(databaseId)) {
    return true
  }

  try {
    const notion = getNotionClient(notionToken)
    const database = await notion.databases.retrieve({
      database_id: databaseId,
    })
    const dataSourceId =
      'data_sources' in database ? database.data_sources[0]?.id : null

    if (!dataSourceId) {
      return false
    }

    await notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: notionSchemaProperties,
    })
    semanticsPropertiesEnsured.add(databaseId)
    return true
  } catch (error) {
    console.error('Failed to ensure Notion semantic properties:', error)
    return false
  }
}

export async function ensureNotionSplitSchemaReady(
  userId: string,
  options: { supabase?: SupabaseClient; profile?: NotionProfileConfig | null } = {}
): Promise<NotionSchemaReadiness> {
  const supabase = options.supabase ?? createAdminClient()
  let profile = options.profile ?? null

  if (!profile) {
    const { data, error } = await supabase
      .from('profiles')
      .select('notion_sync_enabled, notion_token, notion_database_id')
      .eq('id', userId)
      .single()

    if (error) {
      return {
        ready: false,
        status: 'not_configured',
        error: `Failed to load Notion profile: ${error.message}`,
      }
    }

    profile = data as NotionProfileConfig | null
  }

  if (!profile?.notion_sync_enabled) {
    return { ready: true, status: 'disabled' }
  }

  if (!profile.notion_token || !profile.notion_database_id) {
    return {
      ready: false,
      status: 'not_configured',
      error: 'Notion sync is enabled but token or database ID is missing',
    }
  }

  const ready = await ensureTransactionSemanticsProperties(
    profile.notion_database_id,
    profile.notion_token
  )

  if (!ready) {
    return {
      ready: false,
      status: 'schema_update_failed',
      error: 'Required Notion split properties could not be created or verified',
    }
  }

  return { ready: true, status: 'ready' }
}

/**
 * Auto-sync a single transaction when the user's Notion integration is enabled.
 */
export async function syncSingleTransactionIfEnabled(
  userId: string,
  transactionId: string,
  options: { supabase?: SupabaseClient; profile?: NotionProfileConfig | null } = {}
): Promise<NotionSyncStatus> {
  const results = await syncTransactionsIfEnabled(userId, [transactionId], options)
  return results[0] ?? {
    status: 'not_configured',
    synced: false,
    notionPageId: null,
    error: 'Transaction was not found for Notion sync',
  }
}

export async function syncTransactionsIfEnabled(
  userId: string,
  transactionIds: string[],
  options: { supabase?: SupabaseClient; profile?: NotionProfileConfig | null } = {}
): Promise<Array<NotionSyncStatus & { transactionId: string }>> {
  if (transactionIds.length === 0) {
    return []
  }

  const supabase = options.supabase ?? createAdminClient()
  let profile = options.profile ?? null

  if (!profile) {
    const { data, error: profileError } = await supabase
      .from('profiles')
      .select('notion_sync_enabled, notion_token, notion_database_id')
      .eq('id', userId)
      .single()

    if (profileError) {
      return transactionIds.map((transactionId) => ({
        transactionId,
        status: 'failed',
        synced: false,
        notionPageId: null,
        error: `Failed to load Notion profile: ${profileError.message}`,
      }))
    }

    profile = data as NotionProfileConfig | null
  }

  if (!profile?.notion_sync_enabled) {
    return transactionIds.map((transactionId) => ({
      transactionId,
      status: 'disabled',
      synced: false,
      notionPageId: null,
    }))
  }

  if (!profile.notion_token || !profile.notion_database_id) {
    return transactionIds.map((transactionId) => ({
      transactionId,
      status: 'not_configured',
      synced: false,
      notionPageId: null,
      error: 'Notion sync is enabled but token or database ID is missing',
    }))
  }

  const { data: transactions, error: transactionError } = await supabase
    .from('transactions')
    .select(
      `
      *,
      categories!transactions_category_id_fkey ( name, name_zh, icon ),
      accounts!transactions_account_id_fkey ( name )
    `
    )
    .eq('user_id', userId)
    .in('id', transactionIds)

  if (transactionError || !transactions) {
    return transactionIds.map((transactionId) => ({
      transactionId,
      status: 'failed',
      synced: false,
      notionPageId: null,
      error: transactionError?.message || 'Failed to load transaction for Notion sync',
    }))
  }

  const foundTransactionIds = new Set<string>()
  const results: Array<NotionSyncStatus & { transactionId: string }> = []

  for (const transaction of transactions) {
    foundTransactionIds.add(transaction.id)
    const category = transaction.categories as {
      name?: string | null
      name_zh?: string | null
      icon?: string | null
    } | null
    const categoryName = category
      ? `${category.icon ? category.icon + ' ' : ''}${category.name_zh || category.name}`.trim()
      : undefined

    const mappedTransaction = {
      ...transaction,
      category_name: categoryName,
      account_name:
        (transaction.accounts as { name?: string | null } | null)?.name ||
        undefined,
    }

    const notionPageId = await syncTransactionToNotion(
      mappedTransaction,
      profile.notion_database_id,
      profile.notion_token
    )

    if (!notionPageId) {
      results.push({
        transactionId: transaction.id,
        status: 'failed',
        synced: false,
        notionPageId: null,
        error: 'Notion API did not return a page ID',
      })
      continue
    }

    const { error: updateError } = await supabase
      .from('transactions')
      .update({ notion_page_id: notionPageId })
      .eq('id', transaction.id)
      .eq('user_id', userId)

    if (updateError) {
      results.push({
        transactionId: transaction.id,
        status: 'failed',
        synced: false,
        notionPageId: null,
        error: `Failed to persist Notion page ID: ${updateError.message}`,
      })
      continue
    }

    results.push({
      transactionId: transaction.id,
      status: 'synced',
      synced: true,
      notionPageId,
    })
  }

  for (const transactionId of transactionIds) {
    if (!foundTransactionIds.has(transactionId)) {
      results.push({
        transactionId,
        status: 'failed',
        synced: false,
        notionPageId: null,
        error: 'Transaction was not found for Notion sync',
      })
    }
  }

  return results
}

export async function enqueueNotionSyncOutbox(
  supabase: Pick<SupabaseClient, 'rpc'>,
  jobs: Array<{
    userId: string
    transactionId?: string | null
    splitGroupId?: string | null
    jobType: NotionSyncOutboxJobType
    idempotencyKey: string
    availableAt?: string
  }>
) {
  if (jobs.length === 0) {
    return { enqueued: 0 }
  }

  for (const job of jobs) {
    const { error } = await supabase.rpc('enqueue_notion_sync_outbox', {
      p_user_id: job.userId,
      p_transaction_id: job.transactionId ?? null,
      p_split_group_id: job.splitGroupId ?? null,
      p_job_type: job.jobType,
      p_idempotency_key: job.idempotencyKey,
      p_available_at: job.availableAt ?? new Date().toISOString(),
    })

    if (error) {
      throw new Error(`Failed to enqueue Notion sync outbox: ${error.message}`)
    }
  }

  return { enqueued: jobs.length }
}

export async function processNotionSyncOutbox({
  supabase = createAdminClient(),
  limit = 20,
  now = new Date(),
  maxAttempts = 5,
}: {
  supabase?: SupabaseClient
  limit?: number
  now?: Date
  maxAttempts?: number
} = {}): Promise<ProcessNotionSyncOutboxResult> {
  const { data, error } = await supabase
    .from('notion_sync_outbox')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('available_at', now.toISOString())
    .order('available_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to load Notion sync outbox: ${error.message}`)
  }

  const rows = ((data || []) as NotionSyncOutboxRow[]).slice(0, limit)
  const summary: ProcessNotionSyncOutboxResult = {
    checked: rows.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    skipped: 0,
    results: [],
  }

  for (const row of rows) {
    const claimed = await claimNotionSyncOutboxRow(supabase, row, now)
    if (!claimed) {
      summary.skipped++
      summary.results.push({
        id: row.id,
        jobType: row.job_type,
        status: 'skipped',
      })
      continue
    }

    summary.processed++

    try {
      await processNotionSyncOutboxRow(supabase, row)
      await supabase
        .from('notion_sync_outbox')
        .update({
          status: 'succeeded',
          last_error: null,
          updated_at: now.toISOString(),
        })
        .eq('id', row.id)

      summary.succeeded++
      summary.results.push({
        id: row.id,
        jobType: row.job_type,
        status: 'succeeded',
      })
    } catch (error) {
      const nextAttempts = row.attempts + 1
      const status = nextAttempts >= maxAttempts ? 'dead' : 'failed'
      const message =
        error instanceof Error ? error.message : 'Unknown Notion outbox error'
      await supabase
        .from('notion_sync_outbox')
        .update({
          status,
          attempts: nextAttempts,
          last_error: message,
          available_at: nextOutboxRetryAt(now, nextAttempts),
          updated_at: now.toISOString(),
        })
        .eq('id', row.id)

      if (status === 'dead') {
        summary.dead++
      } else {
        summary.failed++
      }
      summary.results.push({
        id: row.id,
        jobType: row.job_type,
        status,
        error: message,
      })
    }
  }

  return summary
}

async function claimNotionSyncOutboxRow(
  supabase: SupabaseClient,
  row: NotionSyncOutboxRow,
  now: Date
) {
  const { data, error } = await supabase
    .from('notion_sync_outbox')
    .update({
      status: 'running',
      updated_at: now.toISOString(),
    })
    .eq('id', row.id)
    .in('status', ['pending', 'failed'])
    .select('id')

  if (error) {
    throw new Error(`Failed to claim Notion outbox job: ${error.message}`)
  }

  return Array.isArray(data) && data.length > 0
}

async function processNotionSyncOutboxRow(
  supabase: SupabaseClient,
  row: NotionSyncOutboxRow
) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('notion_sync_enabled, notion_token, notion_database_id')
    .eq('id', row.user_id)
    .single()

  if (profileError) {
    throw new Error(`Failed to load Notion profile: ${profileError.message}`)
  }

  const profileConfig = profile as NotionProfileConfig | null
  if (!profileConfig?.notion_sync_enabled) {
    return
  }

  const readiness = await ensureNotionSplitSchemaReady(row.user_id, {
    supabase,
    profile: profileConfig,
  })
  if (!readiness.ready) {
    throw new Error(readiness.error)
  }

  const transactionIds = await getNotionOutboxTransactionIds(supabase, row)
  if (transactionIds.length === 0) {
    return
  }

  const syncResults = await syncTransactionsIfEnabled(row.user_id, transactionIds, {
    supabase,
    profile: profileConfig,
  })
  const failed = syncResults.filter(
    (result) => result.status !== 'synced' && result.status !== 'disabled'
  )

  if (failed.length > 0) {
    throw new Error(
      failed
        .map((result) => `${result.transactionId}: ${'error' in result ? result.error || result.status : result.status}`)
        .join('; ')
    )
  }
}

async function getNotionOutboxTransactionIds(
  supabase: SupabaseClient,
  row: NotionSyncOutboxRow
) {
  if (row.job_type !== 'sync_split_group') {
    return row.transaction_id ? [row.transaction_id] : []
  }

  if (!row.split_group_id) {
    return row.transaction_id ? [row.transaction_id] : []
  }

  const ids = new Set<string>()
  if (row.transaction_id) {
    ids.add(row.transaction_id)
  }

  const { data, error } = await supabase
    .from('transactions')
    .select('id')
    .eq('user_id', row.user_id)
    .eq('split_group_id', row.split_group_id)
    .eq('split_role', 'child')
    .is('deleted_at', null)
    .order('split_sequence', { ascending: true })

  if (error) {
    throw new Error(`Failed to load split group transactions: ${error.message}`)
  }

  for (const transaction of (data || []) as Array<{ id: string }>) {
    ids.add(transaction.id)
  }

  return Array.from(ids)
}

function nextOutboxRetryAt(now: Date, attempts: number) {
  const delayMinutes = Math.min(5 * 2 ** Math.max(attempts - 1, 0), 360)
  return new Date(now.getTime() + delayMinutes * 60_000).toISOString()
}

/**
 * Find a Notion page by transaction ID (for deduplication)
 */
async function findNotionPageByTransactionId(
  databaseId: string,
  transactionId: string,
  notionToken?: string
): Promise<string | null> {
  try {
    const token = notionToken || process.env.NOTION_TOKEN
    if (!token) throw new Error('No Notion token')

    const response = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            property: 'Transaction ID',
            rich_text: { equals: transactionId },
          },
          page_size: 1,
        }),
      },
    )

    if (!response.ok) {
      return null
    }

    const data: { results?: Array<{ id: string }> } = await response.json()

    if (data.results && data.results.length > 0) {
      return data.results[0].id
    }

    return null
  } catch {
    return null
  }
}

/**
 * Build Notion page properties from a transaction
 */
function buildNotionProperties(
  transaction: Transaction & {
    category_name?: string
    account_name?: string
  },
  includeSemantics = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  const description =
    transaction.merchant_name || transaction.description || 'Unknown'
  const amount = Math.abs(Number(transaction.amount))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const properties: Record<string, any> = {
    Name: {
      title: [{ text: { content: description } }],
    },
    Amount: {
      number: transaction.amount < 0 ? -amount : amount,
    },
    Date: {
      date: { start: getBudgetDate(transaction) },
    },
    'Transaction ID': {
      rich_text: [{ text: { content: transaction.id } }],
    },
    Source: {
      select: { name: transaction.source },
    },
    'Split Role': {
      select: { name: transaction.split_role || 'none' },
    },
    'Hidden From Reports': {
      checkbox: transaction.is_hidden_from_reports === true,
    },
    'Bank Date': {
      date: { start: transaction.date },
    },
    'Original Date': {
      date: { start: transaction.date },
    },
  }

  if (transaction.iso_currency_code) {
    properties.Currency = {
      select: { name: transaction.iso_currency_code },
    }
  }

  if (transaction.category_name) {
    properties.Category = {
      select: { name: transaction.category_name },
    }
  }

  if (transaction.account_name) {
    properties.Account = {
      select: { name: transaction.account_name },
    }
  }

  if (transaction.payment_channel) {
    properties['Payment Channel'] = {
      select: { name: transaction.payment_channel },
    }
  }

  if (transaction.notes) {
    properties.Notes = {
      rich_text: [{ text: { content: transaction.notes } }],
    }
  }

  if (transaction.tags && transaction.tags.length > 0) {
    properties.Tags = {
      multi_select: transaction.tags.map((tag) => ({ name: tag })),
    }
  }

  if (transaction.split_group_id) {
    properties['Split Group ID'] = {
      rich_text: [{ text: { content: transaction.split_group_id } }],
    }
  }

  if (transaction.split_parent_id) {
    properties['Split Parent ID'] = {
      rich_text: [{ text: { content: transaction.split_parent_id } }],
    }
  }

  if (transaction.split_sequence != null) {
    properties['Split Sequence'] = {
      number: Number(transaction.split_sequence),
    }
  }

  if (transaction.deleted_at) {
    properties['Deleted At'] = {
      date: { start: transaction.deleted_at },
    }
  }

  if (transaction.deleted_reason) {
    properties['Deleted Reason'] = {
      rich_text: [{ text: { content: transaction.deleted_reason } }],
    }
  }

  const type =
    transaction.treatment === 'transfer'
      ? 'transfer'
      : transaction.treatment === 'income'
        ? 'income'
        : Number(transaction.amount) < 0
          ? 'income'
          : 'expense'
  properties.Type = { select: { name: type } }

  if (includeSemantics) {
    const kind = formatTransactionKind(transaction)
    const treatment = formatBudgetTreatment(transaction)
    const transferStatus = formatTransferStatus(transaction.transfer_match_status)

    if (kind) {
      properties.Kind = { select: { name: kind } }
    }

    if (treatment) {
      properties['Budget Treatment'] = { select: { name: treatment } }
    }

    properties['Budget Date'] = {
      date: { start: getBudgetDate(transaction) },
    }

    if (transaction.linked_transaction_id) {
      properties['Linked Transaction'] = {
        rich_text: [{ text: { content: transaction.linked_transaction_id } }],
      }
    }

    if (transaction.transfer_group_id) {
      properties['Transfer Group'] = {
        rich_text: [{ text: { content: transaction.transfer_group_id } }],
      }
    }

    if (transferStatus) {
      properties['Transfer Status'] = { select: { name: transferStatus } }
    }

    if (transaction.transfer_match_confidence != null) {
      properties['Match Confidence'] = {
        number: Number(transaction.transfer_match_confidence) / 100,
      }
    }

    const reason = transaction.transfer_match_reason || transaction.refund_match_reason
    if (reason) {
      properties.Reason = {
        rich_text: [{ text: { content: reason } }],
      }
    }
  }

  return properties
}

function formatTransactionKind(transaction: Transaction) {
  const semantics = normalizeTransactionSemantics({
    treatment: transaction.treatment,
    refundSource: transaction.refund_source,
    amount: Number(transaction.amount),
  })

  if (semantics.treatment === 'refund') {
    return semantics.refundSource === 'reimbursement'
      ? 'Reimbursement'
      : 'Refund'
  }
  if (semantics.treatment === 'transfer') return 'Transfer'
  if (semantics.treatment === 'income') return 'Income'
  if (semantics.treatment === 'excluded') return 'Excluded'
  return 'Normal'
}

function formatBudgetTreatment(transaction: Transaction) {
  const semantics = normalizeTransactionSemantics({
    treatment: transaction.treatment,
    refundSource: transaction.refund_source,
    amount: Number(transaction.amount),
  })

  if (semantics.treatment === 'spending' || semantics.treatment === 'refund') {
    return 'Counts as Spending'
  }
  if (semantics.treatment === 'income') return 'Counts as Income'
  if (semantics.treatment === 'transfer') return 'Excluded as Transfer'
  if (semantics.treatment === 'excluded') return 'Excluded Manually'
  return null
}

function formatTransferStatus(status: Transaction['transfer_match_status']) {
  if (status === 'auto_matched' || status === 'manually_matched') return 'Matched'
  if (status === 'suggested') return 'Suggested'
  if (status === 'unmatched') return 'Unmatched'
  if (status === 'ignored') return 'Ignored'
  return null
}
