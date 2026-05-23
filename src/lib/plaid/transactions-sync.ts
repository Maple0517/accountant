import type { SupabaseClient } from '@supabase/supabase-js'
import { syncTransactionsIfEnabled } from '@/lib/notion/sync'
import {
  getUserCategories,
  getOrCreateCategory,
  getOrCreateRefundedCategory,
} from '@/lib/categories-db'
import { getCategoryFromPlaid } from '@/lib/categories'
import { getPlaidClient } from '@/lib/plaid/client'
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
import {
  findLikelyOriginalPurchase,
  isLikelyRefundCandidate,
} from '@/lib/transactions/refund-matching'
import { deriveBudgetBehavior } from '@/lib/transactions/semantics'
import {
  detectTransferSemantics,
  type TransferAccountContext,
} from '@/lib/transactions/transfer-matching'
import type { BudgetBehavior, SemanticOverrideSource } from '@/types'

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

type ExistingPlaidTransaction = {
  id: string
  plaid_transaction_id: string
  category_id: string | null
  merchant_name: string | null
  tags?: string[] | null
  transaction_kind?: string | null
  budget_behavior?: BudgetBehavior | null
  linked_transaction_id?: string | null
  budget_effective_date?: string | null
  refund_match_confidence?: number | null
  refund_match_reason?: string | null
  transfer_group_id?: string | null
  transfer_match_status?: string | null
  transfer_match_confidence?: number | null
  transfer_match_reason?: string | null
  semantic_override_source?: SemanticOverrideSource | null
}

type PlaidSyncAccount = TransferAccountContext & {
  plaid_account_id: string
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

function shouldPreserveSemanticTreatment(source: SemanticOverrideSource | null | undefined) {
  return source === 'user' || source === 'rule'
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
      await getPlaidClient().itemWebhookUpdate({
        access_token: item.access_token,
        webhook: process.env.PLAID_WEBHOOK_URL,
      })
    } catch (error) {
      console.error('Error updating Plaid item webhook:', error)
    }
  }

  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, plaid_account_id, name, type, subtype')
    .eq('user_id', itemUserId)
    .eq('plaid_item_id', plaidItemId)

  const accountRows = (accounts || []) as PlaidSyncAccount[]
  const accountMap = new Map(accountRows.map((a) => [a.plaid_account_id, a.id]))
  const accountByLocalId = new Map(accountRows.map((a) => [a.id, a]))
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
    const response = await getPlaidClient().transactionsSync({
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
    const transferTreatments = detectTransferSemantics(
      upsertList
        .map((tx) => {
          const localAccountId = accountMap.get(tx.account_id)
          const account = localAccountId ? accountByLocalId.get(localAccountId) : undefined

          if (!localAccountId || !account) {
            return null
          }

          return {
            id: tx.transaction_id,
            accountId: localAccountId,
            amount: Number(tx.amount),
            date: tx.date,
            name: tx.name,
            merchantName: tx.merchant_name || null,
            account,
          }
        })
        .filter((tx): tx is NonNullable<typeof tx> => tx !== null)
    )

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
      .select(`
        id,
        plaid_transaction_id,
        category_id,
        merchant_name,
        tags,
        transaction_kind,
        budget_behavior,
        linked_transaction_id,
        budget_effective_date,
        refund_match_confidence,
        refund_match_reason,
        transfer_group_id,
        transfer_match_status,
        transfer_match_confidence,
        transfer_match_reason,
        semantic_override_source
      `)
      .eq('user_id', itemUserId)
      .in('plaid_transaction_id', existingPlaidIds)

    if (existingTransactionsError) {
      console.error('Error loading existing transactions:', existingTransactionsError)
    }

    const existingTransactionMap = new Map(
      ((existingTransactions || []) as ExistingPlaidTransaction[]).map((tx) => [
        tx.plaid_transaction_id,
        tx,
      ])
    )

    const classMap = new Map(classified.map((c) => [c.id, c]))
    const transactionsToUpsert = []

    for (const tx of upsertList) {
      const existingTransaction = existingTransactionMap.get(tx.transaction_id)
      const preserveSemanticTreatment = shouldPreserveSemanticTreatment(
        existingTransaction?.semantic_override_source
      )
      const transferTreatment =
        !preserveSemanticTreatment &&
        existingTransaction?.transfer_match_status !== 'ignored'
          ? transferTreatments.get(tx.transaction_id)
          : undefined
      const shouldApplyTransferExclusion =
        transferTreatment?.budgetBehavior === 'exclude_as_transfer'
      const localAccountId = accountMap.get(tx.account_id)
      if (!localAccountId) {
        continue
      }

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

      const refundCandidate = isLikelyRefundCandidate(tx)
      let nextCategoryId = categoryId
      let transactionKind =
        existingTransaction?.transaction_kind && existingTransaction.transaction_kind !== 'normal'
          ? existingTransaction.transaction_kind
          : refundCandidate
            ? 'refund'
            : 'normal'
      let linkedTransactionId = existingTransaction?.linked_transaction_id ?? null
      let budgetEffectiveDate = existingTransaction?.budget_effective_date ?? tx.date
      let refundMatchConfidence = existingTransaction?.refund_match_confidence ?? null
      let refundMatchReason = existingTransaction?.refund_match_reason ?? null
      let transferGroupId = existingTransaction?.transfer_group_id ?? null
      let transferMatchStatus = existingTransaction?.transfer_match_status ?? null
      let transferMatchConfidence = existingTransaction?.transfer_match_confidence ?? null
      let transferMatchReason = existingTransaction?.transfer_match_reason ?? null

      if (
        !shouldApplyTransferExclusion &&
        refundCandidate &&
        !existingTransaction?.linked_transaction_id &&
        existingTransaction?.transaction_kind !== 'reimbursement'
      ) {
        const match = await findLikelyOriginalPurchase({
          supabase,
          userId: itemUserId,
          accountId: localAccountId,
          refundAmountAbs: Math.abs(Number(tx.amount)),
          merchantName: cleanName,
          refundDate: tx.date,
        })

        transactionKind = 'refund'

        if (match) {
          const refundedCategory = await getOrCreateRefundedCategory(
            supabase,
            itemUserId,
            userCategories
          )

          linkedTransactionId = match.original.id
          budgetEffectiveDate = match.original.date
          refundMatchConfidence = match.confidence
          refundMatchReason = match.reason
          nextCategoryId =
            refundedCategory?.id ?? match.original.category_id ?? nextCategoryId
        } else if (!existingTransaction?.budget_effective_date) {
          budgetEffectiveDate = tx.date
          refundMatchConfidence = null
          refundMatchReason = null
        }
      }

      if (transferTreatment) {
        if (shouldApplyTransferExclusion) {
          const transferCategory = await getOrCreateCategory(
            supabase,
            itemUserId,
            {
              name: 'Transfer',
              name_zh: '转账',
              icon: '🔄',
              type: 'transfer',
            },
            userCategories
          )

          transactionKind = transferTreatment.transactionKind ?? 'transfer'
          nextCategoryId = transferCategory?.id ?? nextCategoryId
          linkedTransactionId = null
          budgetEffectiveDate = tx.date
          refundMatchConfidence = null
          refundMatchReason = null
        }

        transferGroupId = transferTreatment.transferGroupId
        transferMatchStatus = transferTreatment.transferMatchStatus
        transferMatchConfidence = transferTreatment.transferMatchConfidence
        transferMatchReason = transferTreatment.transferMatchReason
      }

      const categoryForBudgetBehavior = nextCategoryId
        ? userCategories.find((category) => category.id === nextCategoryId)
        : null
      const budgetBehavior =
        preserveSemanticTreatment && existingTransaction?.budget_behavior
          ? existingTransaction.budget_behavior
          : transferTreatment?.budgetBehavior ??
            deriveBudgetBehavior({
              transactionKind,
              category: categoryForBudgetBehavior,
            })
      const semanticOverrideSource =
        existingTransaction?.semantic_override_source ??
        (transferTreatment ? 'system' : 'system')

      transactionsToUpsert.push({
        user_id: itemUserId,
        account_id: localAccountId,
        category_id: nextCategoryId,
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
        transaction_kind: transactionKind,
        budget_behavior: budgetBehavior,
        linked_transaction_id: linkedTransactionId,
        budget_effective_date: budgetEffectiveDate,
        refund_match_confidence: refundMatchConfidence,
        refund_match_reason: refundMatchReason,
        transfer_group_id: transferGroupId,
        transfer_match_status: transferMatchStatus,
        transfer_match_confidence: transferMatchConfidence,
        transfer_match_reason: transferMatchReason,
        semantic_override_source: semanticOverrideSource,
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

      await syncTransactionsIfEnabled(
        itemUserId,
        (dbTransactions || []).map((transaction) => transaction.id)
      )
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
