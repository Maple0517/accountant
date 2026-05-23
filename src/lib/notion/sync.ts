import { getNotionClient } from './client'
import { Sema } from 'async-sema'
import type { Transaction } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UpdateDataSourceParameters } from '@notionhq/client'

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


const semanticPropertySchema: NonNullable<UpdateDataSourceParameters['properties']> = {
  Kind: {
    select: {
      options: [
        { name: 'Normal', color: 'default' },
        { name: 'Refund', color: 'green' },
        { name: 'Reimbursement', color: 'blue' },
        { name: 'Transfer', color: 'gray' },
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
        Amount: { number: { format: 'dollar' } },
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
            ],
          },
        },
        Tags: { multi_select: {} },
        'Transaction ID': { rich_text: {} },
        ...semanticPropertySchema,
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
      properties: semanticPropertySchema,
    })
    semanticsPropertiesEnsured.add(databaseId)
    return true
  } catch (error) {
    console.error('Failed to ensure Notion semantic properties:', error)
    return false
  }
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
      date: { start: transaction.date },
    },
    'Transaction ID': {
      rich_text: [{ text: { content: transaction.id } }],
    },
    Source: {
      select: { name: transaction.source },
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

  const type =
    transaction.budget_behavior === 'exclude_as_transfer'
      ? 'transfer'
      : transaction.budget_behavior === 'count_as_income'
        ? 'income'
        : Number(transaction.amount) < 0
          ? 'income'
          : 'expense'
  properties.Type = { select: { name: type } }

  if (includeSemantics) {
    const kind = formatTransactionKind(transaction.transaction_kind)
    const treatment = formatBudgetTreatment(transaction.budget_behavior)
    const transferStatus = formatTransferStatus(transaction.transfer_match_status)

    if (kind) {
      properties.Kind = { select: { name: kind } }
    }

    if (treatment) {
      properties['Budget Treatment'] = { select: { name: treatment } }
    }

    properties['Budget Date'] = {
      date: { start: transaction.budget_effective_date || transaction.date },
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

function formatTransactionKind(kind: Transaction['transaction_kind']) {
  if (kind === 'refund') return 'Refund'
  if (kind === 'reimbursement') return 'Reimbursement'
  if (kind === 'transfer') return 'Transfer'
  return 'Normal'
}

function formatBudgetTreatment(behavior: Transaction['budget_behavior']) {
  if (behavior === 'count_as_spending') return 'Counts as Spending'
  if (behavior === 'count_as_income') return 'Counts as Income'
  if (behavior === 'exclude_as_transfer') return 'Excluded as Transfer'
  if (behavior === 'exclude_manual') return 'Excluded Manually'
  return null
}

function formatTransferStatus(status: Transaction['transfer_match_status']) {
  if (status === 'auto_matched' || status === 'manually_matched') return 'Matched'
  if (status === 'suggested') return 'Suggested'
  if (status === 'unmatched') return 'Unmatched'
  if (status === 'ignored') return 'Ignored'
  return null
}
