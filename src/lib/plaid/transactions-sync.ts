import type { SupabaseClient } from '@supabase/supabase-js'
import { syncSingleTransactionIfEnabled } from '@/lib/notion/sync'
import { getUserCategories, getOrCreateCategory } from '@/lib/categories-db'
import { getCategoryFromPlaid } from '@/lib/categories'
import { plaidClient } from '@/lib/plaid/client'
import {
  getPlaidPrimaryCategory,
  mergeTransactionClassification,
  PlaidCategorySource,
} from '@/lib/plaid/classification'
import {
  classifyTransactionsBatch,
  ClassifiedTransaction,
  RawTransactionToClassify,
} from '@/lib/gemini/classifier'

type PlaidSyncTransaction = PlaidCategorySource & {
  account_id: string
  amount: number
  authorized_date?: string | null
  date: string
  iso_currency_code?: string | null
  merchant_name?: string | null
  name: string
  payment_channel?: string
  pending: boolean
  transaction_id: string
}

type PlaidRemovedTransaction = {
  transaction_id: string
}

type SyncPlaidItemTransactionsInput = {
  supabase: SupabaseClient
  plaidItemId: string
  userId?: string
  backfillUncategorized?: boolean
  ensureWebhook?: boolean
}

export type SyncPlaidItemTransactionsResult = {
  success: true
  added: number
  modified: number
  removed: number
  backfilled_uncategorized: boolean
  uncategorized_before_sync: number
}

export function getSafePlaidSyncError(error: unknown) {
  if (error instanceof Error && error.message === 'Item not found') {
    return error.message
  }

  return 'Failed to sync available Plaid updates'
}

export async function syncPlaidItemTransactions({
  supabase,
  plaidItemId,
  userId,
  backfillUncategorized,
  ensureWebhook,
}: SyncPlaidItemTransactionsInput): Promise<SyncPlaidItemTransactionsResult> {
  let itemQuery = supabase
    .from('plaid_items')
    .select('access_token, cursor, user_id')
    .eq('id', plaidItemId)

  if (userId) {
    itemQuery = itemQuery.eq('user_id', userId)
  }

  const { data: item, error: itemError } = await itemQuery.single()

  if (itemError || !item) {
    throw new Error('Item not found')
  }

  const itemUserId = item.user_id as string

  if (ensureWebhook && process.env.PLAID_WEBHOOK_URL) {
    try {
      await plaidClient.itemWebhookUpdate({
        access_token: item.access_token,
        webhook: process.env.PLAID_WEBHOOK_URL,
      })
    } catch (error) {
      console.error('Error updating Plaid item webhook:', error)
    }
  }

  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, plaid_account_id')
    .eq('user_id', itemUserId)
    .eq('plaid_item_id', plaidItemId)

  const accountMap = new Map(accounts?.map(a => [a.plaid_account_id, a.id]) || [])
  const accountIds = Array.from(accountMap.values())

  let uncategorizedCount = 0
  if (accountIds.length > 0) {
    const { count, error: uncategorizedCountError } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', itemUserId)
      .eq('source', 'plaid')
      .is('category_id', null)
      .in('account_id', accountIds)

    if (uncategorizedCountError) {
      console.error(
        'Error checking uncategorized Plaid transactions:',
        uncategorizedCountError
      )
    } else {
      uncategorizedCount = count || 0
    }
  }

  const shouldBackfillUncategorized =
    Boolean(backfillUncategorized) || uncategorizedCount > 0
  let cursor = shouldBackfillUncategorized ? undefined : item.cursor || undefined
  let added: PlaidSyncTransaction[] = []
  let modified: PlaidSyncTransaction[] = []
  let removed: PlaidRemovedTransaction[] = []
  let hasMore = true

  while (hasMore) {
    const response = await plaidClient.transactionsSync({
      access_token: item.access_token,
      cursor,
    })

    const data = response.data
    added = added.concat(data.added)
    modified = modified.concat(data.modified)
    removed = removed.concat(data.removed)
    hasMore = data.has_more
    cursor = data.next_cursor
  }

  const upsertList = [...added, ...modified].filter(tx => accountMap.has(tx.account_id))

  if (upsertList.length > 0) {
    const userCategories = await getUserCategories(supabase, itemUserId)

    const rawTxs: RawTransactionToClassify[] = upsertList.map((tx) => ({
      id: tx.transaction_id,
      merchant_name: tx.merchant_name || null,
      description: tx.name,
      amount: tx.amount,
    }))

    let classified: ClassifiedTransaction[] = []
    try {
      classified = await classifyTransactionsBatch(rawTxs, userCategories)
    } catch (err) {
      console.error('Classification failed, continuing with raw names', err)
    }

    const existingPlaidIds = upsertList.map((tx) => tx.transaction_id)
    const { data: existingTransactions, error: existingTransactionsError } = await supabase
      .from('transactions')
      .select('plaid_transaction_id, category_id, merchant_name, tags')
      .eq('user_id', itemUserId)
      .in('plaid_transaction_id', existingPlaidIds)

    if (existingTransactionsError) {
      console.error('Error loading existing transactions:', existingTransactionsError)
    }

    const existingTransactionMap = new Map(
      (existingTransactions || []).map((tx) => [tx.plaid_transaction_id, tx])
    )

    const classMap = new Map(classified.map((c) => [c.id, c]))
    const transactionsToUpsert = []

    for (const tx of upsertList) {
      const existingTransaction = existingTransactionMap.get(tx.transaction_id)
      let classificationForMerge:
        | {
            clean_merchant_name: string
            category?: { id: string }
          }
        | undefined

      const cInfo = classMap.get(tx.transaction_id)
      if (cInfo) {
        if (cInfo.category) {
          const catRow = await getOrCreateCategory(
            supabase,
            itemUserId,
            cInfo.category,
            userCategories
          )
          if (catRow) {
            classificationForMerge = {
              clean_merchant_name: cInfo.clean_merchant_name,
              category: { id: catRow.id },
            }
          }
        }

        if (!classificationForMerge) {
          classificationForMerge = {
            clean_merchant_name: cInfo.clean_merchant_name,
          }
        }
      }

      let plaidFallback:
        | {
            category: { id: string }
          }
        | undefined

      if (!classificationForMerge?.category && !existingTransaction?.category_id) {
        const plaidCategory = getCategoryFromPlaid(getPlaidPrimaryCategory(tx))
        const catRow = await getOrCreateCategory(
          supabase,
          itemUserId,
          plaidCategory,
          userCategories
        )

        if (catRow) {
          plaidFallback = { category: { id: catRow.id } }
        }
      }

      const { categoryId, cleanName, tags } = mergeTransactionClassification(
        existingTransaction,
        tx,
        classificationForMerge,
        plaidFallback
      )

      transactionsToUpsert.push({
        user_id: itemUserId,
        account_id: accountMap.get(tx.account_id),
        category_id: categoryId,
        plaid_transaction_id: tx.transaction_id,
        amount: tx.amount,
        iso_currency_code: tx.iso_currency_code || 'USD',
        date: tx.date,
        authorized_date: tx.authorized_date || null,
        merchant_name: cleanName,
        description: tx.name,
        payment_channel: tx.payment_channel,
        pending: tx.pending,
        source: 'plaid',
        tags,
      })
    }

    const { error: upsertError } = await supabase
      .from('transactions')
      .upsert(transactionsToUpsert, { onConflict: 'plaid_transaction_id' })

    if (upsertError) {
      console.error('Error upserting transactions:', upsertError)
    } else {
      const upsertedPlaidIds = transactionsToUpsert.map((tx) => tx.plaid_transaction_id)
      const { data: dbTransactions } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_id', itemUserId)
        .in('plaid_transaction_id', upsertedPlaidIds)

      for (const transaction of dbTransactions || []) {
        await syncSingleTransactionIfEnabled(itemUserId, transaction.id)
      }
    }
  }

  if (removed.length > 0) {
    const removedIds = removed.map(tx => tx.transaction_id)
    const { error: deleteError } = await supabase
      .from('transactions')
      .delete()
      .eq('user_id', itemUserId)
      .in('plaid_transaction_id', removedIds)

    if (deleteError) {
      console.error('Error deleting transactions:', deleteError)
    }
  }

  await supabase
    .from('plaid_items')
    .update({
      cursor,
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    })
    .eq('id', plaidItemId)
    .eq('user_id', itemUserId)

  return {
    success: true,
    added: added.length,
    modified: modified.length,
    removed: removed.length,
    backfilled_uncategorized: shouldBackfillUncategorized,
    uncategorized_before_sync: uncategorizedCount,
  }
}
