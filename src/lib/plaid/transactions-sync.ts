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
import { MANUAL_REVIEWED_REFUND_REASON } from '@/lib/transactions/review'
import {
  detectTransferSemantics,
  type TransferAccountContext,
} from '@/lib/transactions/transfer-matching'
import {
  deriveTransactionTreatment,
  normalizeTransactionSemantics,
} from '@/lib/transactions/treatment'
import type {
  RefundSource,
  SemanticOverrideSource,
  TransactionTreatment,
} from '@/types'

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
  pending_transaction_id?: string | null
  transaction_id: string
}

type PlaidRemovedTransaction = {
  transaction_id: string
}

type ExistingPlaidTransaction = {
  id: string
  plaid_transaction_id: string
  account_id?: string | null
  amount?: number | null
  date?: string | null
  description?: string | null
  split_role?: string | null
  split_group_id?: string | null
  category_id: string | null
  merchant_name: string | null
  tags?: string[] | null
  treatment?: TransactionTreatment | null
  refund_source?: RefundSource | null
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

type TrustedSoftDeleteRpcResult = {
  data: number | null
  error: { message?: string } | null
}

type TrustedPlaidSplitParentRpcResult = {
  data: unknown | null
  error: { message?: string } | null
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

export async function softDeletePlaidRemovedTransactions({
  supabase,
  userId,
  plaidTransactionIds,
  deletedReason = 'plaid_removed',
}: {
  supabase: Pick<SupabaseClient, 'rpc'>
  userId: string
  plaidTransactionIds: string[]
  deletedReason?: string
}) {
  if (plaidTransactionIds.length === 0) {
    return 0
  }

  const { data, error } = (await supabase.rpc(
    'soft_delete_transactions_for_trusted_sync',
    {
      p_user_id: userId,
      p_transaction_ids: null,
      p_plaid_transaction_ids: plaidTransactionIds,
      p_deleted_reason: deletedReason,
    }
  )) as TrustedSoftDeleteRpcResult

  if (error) {
    throw new Error(
      `Failed to soft-delete removed Plaid transactions: ${error.message}`
    )
  }

  return data ?? 0
}

export async function applyPlaidUpdateToSplitParentForTrustedSync({
  supabase,
  parentTransactionId,
  plaidTransactionId,
  amount,
  date,
  authorizedDate,
  merchantName,
  description,
  paymentChannel,
  pending,
  isoCurrencyCode,
  eventType = 'plaid_modified',
}: {
  supabase: Pick<SupabaseClient, 'rpc'>
  parentTransactionId: string
  plaidTransactionId: string
  amount: number
  date: string
  authorizedDate?: string | null
  merchantName?: string | null
  description: string
  paymentChannel?: string | null
  pending: boolean
  isoCurrencyCode?: string | null
  eventType?: 'plaid_modified' | 'plaid_pending_replaced'
}) {
  const { error } = (await supabase.rpc(
    'apply_plaid_update_to_split_parent_for_trusted_sync',
    {
      p_parent_transaction_id: parentTransactionId,
      p_plaid_transaction_id: plaidTransactionId,
      p_amount: amount,
      p_date: date,
      p_authorized_date: authorizedDate ?? null,
      p_merchant_name: merchantName ?? null,
      p_description: description,
      p_payment_channel: paymentChannel ?? null,
      p_pending: pending,
      p_iso_currency_code: isoCurrencyCode || 'USD',
      p_event_type: eventType,
      p_pending_transaction_id: null,
    }
  )) as TrustedPlaidSplitParentRpcResult

  if (error) {
    throw new Error(
      `Failed to apply Plaid update to split parent: ${error.message}`
    )
  }
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

function normalizePlaidMatchText(value: string | null | undefined) {
  return (value || '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function daysBetween(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return Number.POSITIVE_INFINITY
  const left = new Date(`${a}T00:00:00`).getTime()
  const right = new Date(`${b}T00:00:00`).getTime()
  return Math.abs(left - right) / 86_400_000
}

export function isLikelyPendingReplacement(
  candidate: PlaidSyncTransaction,
  removed: ExistingPlaidTransaction,
  accountMap: Map<string, string>
) {
  const localAccountId = accountMap.get(candidate.account_id)
  if (!localAccountId || localAccountId !== removed.account_id) return false

  const amountDelta = Math.abs(Number(candidate.amount) - Number(removed.amount ?? 0))
  if (amountDelta > 0.01) return false
  if (daysBetween(candidate.date, removed.date) > 7) return false

  const candidateName = normalizePlaidMatchText(candidate.merchant_name || candidate.name)
  const removedName = normalizePlaidMatchText(removed.merchant_name || removed.description)
  return Boolean(
    candidateName &&
      removedName &&
      (candidateName.includes(removedName) || removedName.includes(candidateName))
  )
}

export function resolvePendingSplitParentReplacement({
  removedPlaidTransactionId,
  removedTransaction,
  candidates,
  accountMap,
}: {
  removedPlaidTransactionId: string
  removedTransaction: ExistingPlaidTransaction | undefined
  candidates: PlaidSyncTransaction[]
  accountMap: Map<string, string>
}) {
  if (removedTransaction?.split_role !== 'parent') {
    return null
  }

  const exactCandidate = candidates.find(
    (candidate) =>
      candidate.pending_transaction_id === removedPlaidTransactionId &&
      accountMap.get(candidate.account_id) === removedTransaction.account_id
  )
  if (exactCandidate) {
    return exactCandidate
  }

  const fuzzyCandidates = candidates.filter((candidate) =>
    isLikelyPendingReplacement(candidate, removedTransaction, accountMap)
  )

  return fuzzyCandidates.length === 1 ? fuzzyCandidates[0] : null
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

  let upsertList = [...added, ...modified].filter(tx => accountMap.has(tx.account_id))
  const replacementRemovedIds = new Set<string>()

  if (upsertList.length > 0) {
    const removedIds = removed.map((tx) => tx.transaction_id)
    const removedExistingMap = new Map<string, ExistingPlaidTransaction>()
    if (removedIds.length > 0) {
      const { data: removedExisting, error: removedExistingError } = await supabase
        .from('transactions')
        .select(`
          id,
          account_id,
          amount,
          date,
          merchant_name,
          description,
          plaid_transaction_id,
          split_role,
          split_group_id,
          category_id,
          tags,
          treatment,
          refund_source,
          linked_transaction_id,
          budget_effective_date,
          refund_match_confidence,
          refund_match_reason,
          transfer_group_id,
          transfer_match_status,
          transfer_match_confidence,
          transfer_match_reason,
          semantic_override_source,
          pending_transaction_id
        `)
        .eq('user_id', itemUserId)
        .in('plaid_transaction_id', removedIds)

      if (removedExistingError) {
        console.error('Error loading removed Plaid transactions:', removedExistingError)
      } else {
        for (const tx of (removedExisting || []) as ExistingPlaidTransaction[]) {
          removedExistingMap.set(tx.plaid_transaction_id, tx)
        }
      }
    }

    const replacementCandidateIds = new Set<string>()
    for (const removedTx of removed) {
      const existingRemoved = removedExistingMap.get(removedTx.transaction_id)
      const replacement = resolvePendingSplitParentReplacement({
        removedPlaidTransactionId: removedTx.transaction_id,
        removedTransaction: existingRemoved,
        candidates: upsertList,
        accountMap,
      })
      if (!replacement || !existingRemoved) {
        continue
      }

      await applyPlaidUpdateToSplitParentForTrustedSync({
        supabase,
        parentTransactionId: existingRemoved.id,
        plaidTransactionId: replacement.transaction_id,
        amount: Number(replacement.amount),
        date: replacement.date,
        authorizedDate: replacement.authorized_date ?? null,
        merchantName: replacement.merchant_name ?? null,
        description: replacement.name,
        paymentChannel: replacement.payment_channel ?? null,
        pending: replacement.pending,
        isoCurrencyCode: replacement.iso_currency_code ?? 'USD',
        eventType: 'plaid_pending_replaced',
      })

      replacementRemovedIds.add(removedTx.transaction_id)
      replacementCandidateIds.add(replacement.transaction_id)
    }

    if (replacementCandidateIds.size > 0) {
      upsertList = upsertList.filter(
        (tx) => !replacementCandidateIds.has(tx.transaction_id)
      )
    }

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
        split_role,
        split_group_id,
        category_id,
        merchant_name,
        tags,
        treatment,
        refund_source,
        linked_transaction_id,
        budget_effective_date,
        refund_match_confidence,
        refund_match_reason,
        transfer_group_id,
        transfer_match_status,
        transfer_match_confidence,
        transfer_match_reason,
        semantic_override_source,
        pending_transaction_id
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
    const splitParentUpdates: PlaidSyncTransaction[] = []

    for (const tx of upsertList) {
      const existingTransaction = existingTransactionMap.get(tx.transaction_id)
      if (existingTransaction?.split_role === 'parent') {
        splitParentUpdates.push(tx)
        continue
      }
      const preserveSemanticTreatment = shouldPreserveSemanticTreatment(
        existingTransaction?.semantic_override_source
      )
      const transferTreatment =
        !preserveSemanticTreatment &&
        existingTransaction?.transfer_match_status !== 'ignored'
          ? transferTreatments.get(tx.transaction_id)
          : undefined
      const shouldApplyTransferExclusion =
        transferTreatment?.treatment === 'transfer'
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
      const categoryForSemantics = nextCategoryId
        ? userCategories.find((category) => category.id === nextCategoryId)
        : null
      const existingSemantics = normalizeTransactionSemantics({
        treatment: existingTransaction?.treatment,
        refundSource: existingTransaction?.refund_source,
        category: categoryForSemantics,
      })
      let treatment =
        existingSemantics.treatment !== 'spending'
          ? existingSemantics.treatment
          : deriveTransactionTreatment({
              category: categoryForSemantics,
            })
      let refundSource = existingSemantics.refundSource
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
        existingTransaction?.refund_match_reason !== MANUAL_REVIEWED_REFUND_REASON &&
        existingTransaction?.refund_source !== 'reimbursement'
      ) {
        const match = await findLikelyOriginalPurchase({
          supabase,
          userId: itemUserId,
          accountId: localAccountId,
          refundAmountAbs: Math.abs(Number(tx.amount)),
          merchantName: cleanName,
          refundDate: tx.date,
        })

        treatment = 'refund'
        refundSource = refundSource ?? 'merchant_refund'

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

          treatment = 'transfer'
          refundSource = null
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

      const finalCategoryForSemantics = nextCategoryId
        ? userCategories.find((category) => category.id === nextCategoryId)
        : null
      const normalizedSemantics =
        preserveSemanticTreatment && existingTransaction
          ? normalizeTransactionSemantics({
              treatment: existingTransaction.treatment,
              refundSource: existingTransaction.refund_source,
              category: finalCategoryForSemantics,
            })
          : normalizeTransactionSemantics({
              treatment,
              refundSource,
              category: finalCategoryForSemantics,
              amount: Number(tx.amount),
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
        treatment: normalizedSemantics.treatment,
        refund_source: normalizedSemantics.refundSource,
        linked_transaction_id: linkedTransactionId,
        budget_effective_date: budgetEffectiveDate,
        refund_match_confidence: refundMatchConfidence,
        refund_match_reason: refundMatchReason,
        transfer_group_id: transferGroupId,
        transfer_match_status: transferMatchStatus,
        transfer_match_confidence: transferMatchConfidence,
        transfer_match_reason: transferMatchReason,
        semantic_override_source: semanticOverrideSource,
        pending_transaction_id: tx.pending_transaction_id ?? null,
      })
    }

    for (const tx of splitParentUpdates) {
      const existingTransaction = existingTransactionMap.get(tx.transaction_id)
      if (!existingTransaction) continue

      await applyPlaidUpdateToSplitParentForTrustedSync({
        supabase,
        parentTransactionId: existingTransaction.id,
        plaidTransactionId: tx.transaction_id,
        amount: Number(tx.amount),
        date: tx.date,
        authorizedDate: tx.authorized_date ?? null,
        merchantName: tx.merchant_name ?? null,
        description: tx.name,
        paymentChannel: tx.payment_channel ?? null,
        pending: tx.pending,
        isoCurrencyCode: tx.iso_currency_code ?? 'USD',
      })
    }

    const { error: upsertError } =
      transactionsToUpsert.length > 0
        ? await supabase
            .from('transactions')
            .upsert(transactionsToUpsert, { onConflict: 'plaid_transaction_id' })
        : { error: null }

    if (upsertError) {
      throw new Error(`Failed to persist Plaid transactions: ${upsertError.message}`)
    }

    const upsertedPlaidIds = transactionsToUpsert.map((tx) => tx.plaid_transaction_id)
    if (upsertedPlaidIds.length > 0) {
      const { data: dbTransactions, error: dbTransactionsError } = await supabase
        .from('transactions')
        .select('id')
        .eq('user_id', itemUserId)
        .in('plaid_transaction_id', upsertedPlaidIds)

      if (dbTransactionsError) {
        throw new Error(
          `Failed to load persisted Plaid transactions: ${dbTransactionsError.message}`
        )
      }

      const notionResults = await syncTransactionsIfEnabled(
        itemUserId,
        (dbTransactions || []).map((transaction) => transaction.id)
      )
      const failedNotionSyncs = notionResults.filter(
        (result) => result.status === 'failed'
      )
      if (failedNotionSyncs.length > 0) {
        console.warn('Some Plaid transactions failed to sync to Notion:', failedNotionSyncs)
      }
    }
  }

  if (removed.length > 0) {
    const removedIds = removed
      .map(tx => tx.transaction_id)
      .filter((id) => !replacementRemovedIds.has(id))
    await softDeletePlaidRemovedTransactions({
      supabase,
      userId: itemUserId,
      plaidTransactionIds: removedIds,
    })
  }

  const { error: cursorUpdateError } = await supabase
    .from('plaid_items')
    .update({
      cursor,
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    })
    .eq('id', plaidItemId)
    .eq('user_id', itemUserId)

  if (cursorUpdateError) {
    throw new Error(`Failed to save Plaid sync cursor: ${cursorUpdateError.message}`)
  }

  return {
    success: true,
    added: added.length,
    modified: modified.length,
    removed: removed.length,
    backfilled_uncategorized: shouldBackfillUncategorized,
    uncategorized_before_sync: uncategorizedCount,
  }
}
