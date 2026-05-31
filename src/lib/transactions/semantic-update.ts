import { getTransactionMutationBlockReason } from '@/lib/transactions/mutation-guard'
import {
  deriveLegacyTransactionKind,
  deriveTransactionTreatment,
  isRefundSource,
  isTransactionTreatment,
  normalizeTransactionSemantics,
} from '@/lib/transactions/treatment'
import type {
  BudgetBehavior,
  RefundSource,
  TransactionKind,
  TransactionTreatment,
  TransactionSplitRole,
  TransferMatchStatus,
} from '@/types'

type TransactionCategorySemantics = {
  type?: 'income' | 'expense' | 'transfer' | null
  is_excluded_from_budget?: boolean | null
} | null

type TransactionSemanticsRow = {
  id: string
  user_id: string
  date: string
  amount: number
  category_id: string | null
  treatment: TransactionTreatment | null
  refund_source: RefundSource | null
  transaction_kind: TransactionKind | null
  budget_behavior: BudgetBehavior | null
  transfer_group_id: string | null
  deleted_at?: string | null
  is_hidden_from_reports?: boolean | null
  split_role?: TransactionSplitRole | null
  split_group_id?: string | null
  split_parent_id?: string | null
  categories: TransactionCategorySemantics | TransactionCategorySemantics[]
}

type QueryError = {
  message?: string
}

type QueryResult<T> = {
  data: T | null
  error: QueryError | null
}

export type TransactionSemanticsQuery = PromiseLike<QueryResult<unknown>> & {
  select(columns: string): TransactionSemanticsQuery
  update(payload: Record<string, unknown>): TransactionSemanticsQuery
  eq(column: string, value: unknown): TransactionSemanticsQuery
  neq(column: string, value: unknown): TransactionSemanticsQuery
  is(column: string, value: null): TransactionSemanticsQuery
  single(): Promise<QueryResult<unknown>>
}

export type TransactionSemanticsClient = {
  from(table: string): TransactionSemanticsQuery
}

type EnsureSemanticCategory = (
  supabase: TransactionSemanticsClient,
  userId: string,
  categoryInfo: {
    name: string
    name_zh?: string
    icon?: string
    type?: 'expense' | 'income' | 'transfer'
  }
) => Promise<{ id: string } | null>

type SemanticUpdateBody = Record<string, unknown>

export type TransactionSemanticsUpdateResult =
  | {
      ok: true
      transaction: unknown
      groupUpdated: boolean
    }
  | {
      ok: false
      status: number
      error: string
    }

const VALID_KINDS = new Set<TransactionKind>([
  'normal',
  'refund',
  'reimbursement',
  'transfer',
])

const VALID_TREATMENTS = new Set<TransactionTreatment>([
  'spending',
  'income',
  'refund',
  'transfer',
  'excluded',
])

const VALID_BUDGET_BEHAVIORS = new Set<BudgetBehavior>([
  'count_as_spending',
  'count_as_income',
  'exclude_as_transfer',
  'exclude_manual',
])

const VALID_TRANSFER_STATUSES = new Set<TransferMatchStatus>([
  'unmatched',
  'auto_matched',
  'suggested',
  'manually_matched',
  'ignored',
])

function normalizeCategory(
  category: TransactionSemanticsRow['categories']
): TransactionCategorySemantics {
  return Array.isArray(category) ? category[0] ?? null : category
}

function readBodyValue(body: unknown, key: string) {
  if (!body || typeof body !== 'object') return undefined
  return (body as SemanticUpdateBody)[key]
}

export async function updateTransactionSemantics({
  supabase,
  userId,
  transactionId,
  body,
  ensureCategory,
}: {
  supabase: TransactionSemanticsClient
  userId: string
  transactionId: string
  body: unknown
  ensureCategory: EnsureSemanticCategory
}): Promise<TransactionSemanticsUpdateResult> {
  const rawTreatment = readBodyValue(body, 'treatment')
  const rawRefundSource = readBodyValue(body, 'refund_source')
  const rawKind = readBodyValue(body, 'transaction_kind')
  const rawBudgetBehavior = readBodyValue(body, 'budget_behavior')
  const rawTransferStatus = readBodyValue(body, 'transfer_match_status')
  const requestedTreatment =
    typeof rawTreatment === 'string' &&
    VALID_TREATMENTS.has(rawTreatment as TransactionTreatment)
      ? (rawTreatment as TransactionTreatment)
      : undefined
  const requestedRefundSource =
    typeof rawRefundSource === 'string' && isRefundSource(rawRefundSource)
      ? rawRefundSource
      : undefined
  const requestedKind =
    typeof rawKind === 'string' && VALID_KINDS.has(rawKind as TransactionKind)
      ? (rawKind as TransactionKind)
      : undefined
  const requestedBudgetBehavior =
    typeof rawBudgetBehavior === 'string' &&
    VALID_BUDGET_BEHAVIORS.has(rawBudgetBehavior as BudgetBehavior)
      ? (rawBudgetBehavior as BudgetBehavior)
      : undefined
  const requestedTransferStatus =
    typeof rawTransferStatus === 'string' &&
    VALID_TRANSFER_STATUSES.has(rawTransferStatus as TransferMatchStatus)
      ? (rawTransferStatus as TransferMatchStatus)
      : undefined
  const isExistingDebtPayment =
    readBodyValue(body, 'existing_debt_payment') === true

  if (rawTreatment !== undefined && requestedTreatment === undefined) {
    return { ok: false, status: 400, error: 'Invalid treatment' }
  }

  if (rawRefundSource !== undefined && requestedRefundSource === undefined) {
    return { ok: false, status: 400, error: 'Invalid refund_source' }
  }

  if (rawKind !== undefined && requestedKind === undefined) {
    return { ok: false, status: 400, error: 'Invalid transaction_kind' }
  }

  if (rawBudgetBehavior !== undefined && requestedBudgetBehavior === undefined) {
    return { ok: false, status: 400, error: 'Invalid budget_behavior' }
  }

  if (rawTransferStatus !== undefined && requestedTransferStatus === undefined) {
    return { ok: false, status: 400, error: 'Invalid transfer_match_status' }
  }

  const { data: transactionData, error: transactionError } = await supabase
    .from('transactions')
    .select(`
      id,
      user_id,
      date,
      amount,
      category_id,
      treatment,
      refund_source,
      transaction_kind,
      budget_behavior,
      transfer_group_id,
      deleted_at,
      is_hidden_from_reports,
      split_role,
      split_group_id,
      split_parent_id,
      categories!transactions_category_id_fkey (
        type,
        is_excluded_from_budget
      )
    `)
    .eq('id', transactionId)
    .eq('user_id', userId)
    .single()
  const transaction = transactionData as TransactionSemanticsRow | null

  if (transactionError || !transaction) {
    return { ok: false, status: 404, error: 'Transaction not found' }
  }

  const blockReason = getTransactionMutationBlockReason(transaction)
  if (blockReason) {
    return { ok: false, status: 409, error: blockReason }
  }

  const currentCategory = normalizeCategory(transaction.categories)
  const update: Record<string, unknown> = {
    semantic_override_source: 'user',
  }
  let applyToTransferGroup = false

  if (isExistingDebtPayment) {
    const debtCategory = await ensureCategory(supabase, userId, {
      name: 'Debt Payment',
      name_zh: '债务还款',
      icon: '💳',
      type: 'expense',
    })

    update.treatment = 'spending'
    update.refund_source = null
    update.transaction_kind = 'normal'
    update.budget_behavior = 'count_as_spending'
    update.category_id = debtCategory?.id ?? transaction.category_id
    update.transfer_group_id = null
    update.transfer_match_status = null
    update.transfer_match_confidence = null
    update.transfer_match_reason = null
  } else if (requestedTransferStatus === 'manually_matched') {
    const transferCategory = await ensureCategory(supabase, userId, {
      name: 'Transfer',
      name_zh: '转账',
      icon: '🔄',
      type: 'transfer',
    })

    update.treatment = 'transfer'
    update.refund_source = null
    update.transaction_kind = 'transfer'
    update.budget_behavior = 'exclude_as_transfer'
    update.category_id = transferCategory?.id ?? transaction.category_id
    update.transfer_match_status = 'manually_matched'
    applyToTransferGroup = true
  } else {
    const requestedLegacyTreatment =
      requestedKind || requestedBudgetBehavior
        ? normalizeTransactionSemantics({
            transactionKind: requestedKind,
            budgetBehavior: requestedBudgetBehavior,
            category: requestedBudgetBehavior ? undefined : currentCategory,
          })
        : null
    const nextTreatment =
      requestedTransferStatus === 'ignored' &&
      requestedTreatment === undefined &&
      requestedLegacyTreatment == null
        ? 'spending'
        : requestedTreatment ??
          requestedLegacyTreatment?.treatment ??
          transaction.treatment ??
          deriveTransactionTreatment({
            transactionKind: transaction.transaction_kind,
            budgetBehavior: transaction.budget_behavior,
            category: currentCategory,
          })
    const nextRefundSource =
      nextTreatment === 'refund'
        ? requestedRefundSource ??
          requestedLegacyTreatment?.refundSource ??
          transaction.refund_source ??
          (transaction.transaction_kind === 'reimbursement'
            ? 'reimbursement'
            : 'merchant_refund')
        : null
    const normalized = normalizeTransactionSemantics({
      treatment: nextTreatment,
      refundSource: nextRefundSource,
      amount: transaction.amount,
      category: currentCategory,
    })

    update.treatment = normalized.treatment
    update.refund_source = normalized.refundSource
    update.transaction_kind = normalized.transactionKind
    update.budget_behavior = normalized.budgetBehavior

    if (requestedTransferStatus) {
      update.transfer_match_status = requestedTransferStatus
    }
  }

  if (
    isTransactionTreatment(update.treatment as string | undefined) &&
    update.treatment !== 'transfer'
  ) {
    update.transfer_group_id = null
    update.transfer_match_status =
      requestedTransferStatus === 'ignored' ? 'ignored' : null
    update.transfer_match_confidence = null
    update.transfer_match_reason = null
    applyToTransferGroup = requestedTransferStatus === 'ignored'
  } else if (update.treatment === 'transfer') {
    update.transaction_kind = deriveLegacyTransactionKind({
      treatment: 'transfer',
      refundSource: null,
    })
  }

  let groupUpdated = false

  if (applyToTransferGroup && transaction.transfer_group_id) {
    const groupUpdate = { ...update }
    delete groupUpdate.category_id

    const { error: groupUpdateError } = await supabase
      .from('transactions')
      .update(groupUpdate)
      .eq('user_id', userId)
      .eq('transfer_group_id', transaction.transfer_group_id)
      .neq('id', transactionId)
      .is('deleted_at', null)
      .neq('split_role', 'parent')

    if (groupUpdateError) {
      return {
        ok: false,
        status: 500,
        error: 'Failed to update matching transfer leg',
      }
    }

    groupUpdated = true
  }

  const { data: updated, error: updateError } = await supabase
    .from('transactions')
    .update(update)
    .eq('id', transactionId)
    .eq('user_id', userId)
    .select(`
      *,
      categories!transactions_category_id_fkey (
        id,
        name,
        name_zh,
        icon,
        color,
        is_excluded_from_budget
      )
    `)
    .single()

  if (updateError || !updated) {
    return {
      ok: false,
      status: 500,
      error: 'Failed to update transaction semantics',
    }
  }

  return { ok: true, transaction: updated, groupUpdated }
}
