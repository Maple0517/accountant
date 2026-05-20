import { getNotionClient } from './client'
import { Sema } from 'async-sema'
import type { Transaction } from '@/types'

// Rate limiter: ~3 requests per second
const rateLimiter = new Sema(1, { capacity: 3 })

const NOTION_PROPERTIES = {
  Name: 'title',
  Amount: 'number',
  Currency: 'select',
  Date: 'date',
  Category: 'select',
  Account: 'select',
  Type: 'select',
  'Payment Channel': 'select',
  Notes: 'rich_text',
  Source: 'select',
  Tags: 'multi_select',
  'Transaction ID': 'rich_text',
} as const

/**
 * Create the Notion database structure for transactions
 */
export async function createTransactionDatabase(
  parentPageId: string,
  notionToken?: string
): Promise<string> {
  const notion = getNotionClient(notionToken)

  const response = await notion.databases.create({
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
    },
  })

  return response.id
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

    // Check if already synced (has notion_page_id)
    if (transaction.notion_page_id) {
      // Update existing page
      await notion.pages.update({
        page_id: transaction.notion_page_id,
        properties: buildNotionProperties(transaction),
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
      properties: buildNotionProperties(transaction),
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
): Promise<{ synced: number; failed: number }> {
  let synced = 0
  let failed = 0

  for (const transaction of transactions) {
    const pageId = await syncTransactionToNotion(
      transaction,
      databaseId,
      notionToken
    )

    if (pageId) {
      synced++
    } else {
      failed++
    }

    // Rate limit: ~350ms between requests
    await new Promise((resolve) => setTimeout(resolve, 350))
  }

  return { synced, failed }
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
    const notion = getNotionClient(notionToken)

    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: 'Transaction ID',
        rich_text: { equals: transactionId },
      },
      page_size: 1,
    })

    if (response.results.length > 0) {
      return response.results[0].id
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
  }
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

  // Determine type
  const type = Number(transaction.amount) > 0 ? 'income' : 'expense'
  properties.Type = { select: { name: type } }

  return properties
}
