import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateRefundedCategory } from '@/lib/categories-db'
import { getTransactionMutationBlockReason } from '@/lib/transactions/mutation-guard'
import { MANUAL_REVIEWED_REFUND_REASON } from '@/lib/transactions/review'
import {
  deriveTransactionTreatment,
  isRefundSource,
  isTransactionTreatment,
  normalizeTransactionSemantics,
} from '@/lib/transactions/treatment'
import type {
  RefundSource,
  TransactionKind,
  TransactionTreatment,
} from '@/types'

export const dynamic = 'force-dynamic'

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

function parseDate(value: unknown) {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authClient = await createClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()

    const { id } = await context.params
    const body = await request.json()
    const hasCanonicalSemanticInput =
      body.treatment !== undefined || body.refund_source !== undefined
    const requestedTreatment =
      typeof body.treatment === 'string' &&
      VALID_TREATMENTS.has(body.treatment as TransactionTreatment)
        ? (body.treatment as TransactionTreatment)
        : undefined
    const requestedRefundSource =
      typeof body.refund_source === 'string' && isRefundSource(body.refund_source)
        ? (body.refund_source as RefundSource)
        : undefined
    const requestedKind =
      typeof body.transaction_kind === 'string' && VALID_KINDS.has(body.transaction_kind)
        ? (body.transaction_kind as TransactionKind)
        : undefined
    const requestedLinkedId =
      typeof body.linked_transaction_id === 'string'
        ? body.linked_transaction_id
        : body.linked_transaction_id === null
          ? null
          : undefined
    const requestedBudgetDate = parseDate(body.budget_effective_date)
    const requestedReviewed = body.reviewed === true

    if (body.treatment !== undefined && requestedTreatment === undefined) {
      return Response.json({ error: 'Invalid treatment' }, { status: 400 })
    }

    if (body.refund_source !== undefined && requestedRefundSource === undefined) {
      return Response.json({ error: 'Invalid refund_source' }, { status: 400 })
    }

    if (
      body.budget_effective_date !== undefined &&
      requestedBudgetDate === undefined
    ) {
      return Response.json(
        { error: 'budget_effective_date must be YYYY-MM-DD or null' },
        { status: 400 }
      )
    }

    const { data: transaction, error: transactionError } = await supabase
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
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (transactionError || !transaction) {
      return Response.json({ error: 'Transaction not found' }, { status: 404 })
    }

    const blockReason = getTransactionMutationBlockReason(transaction)
    if (blockReason) {
      return Response.json({ error: blockReason }, { status: 409 })
    }

    const update: Record<string, unknown> = {}
    const transactionCategory = Array.isArray(transaction.categories)
      ? transaction.categories[0]
      : transaction.categories
    const currentTreatment =
      transaction.treatment ??
      deriveTransactionTreatment({
        transactionKind: transaction.transaction_kind,
        budgetBehavior: transaction.budget_behavior,
        category: transactionCategory,
      })

    if (requestedTreatment || requestedRefundSource || requestedKind) {
      const normalized = normalizeTransactionSemantics({
        treatment:
          requestedTreatment ??
          (!hasCanonicalSemanticInput && requestedKind
            ? normalizeTransactionSemantics({
                transactionKind: requestedKind,
                category: transactionCategory,
              }).treatment
            : currentTreatment),
        refundSource:
          requestedRefundSource ??
          transaction.refund_source ??
          (!hasCanonicalSemanticInput && requestedKind === 'reimbursement'
            ? 'reimbursement'
            : undefined),
        amount: transaction.amount,
        category: transactionCategory,
      })
      update.treatment = normalized.treatment
      update.refund_source = normalized.refundSource
      update.transaction_kind = normalized.transactionKind
      update.budget_behavior = normalized.budgetBehavior
      update.semantic_override_source = 'user'
    }

    if (requestedBudgetDate !== undefined) {
      update.budget_effective_date = requestedBudgetDate ?? transaction.date
    }

    if (requestedLinkedId !== undefined) {
      if (requestedLinkedId === null) {
        update.linked_transaction_id = null
        update.budget_effective_date = transaction.date
        update.refund_match_confidence = null
        update.refund_match_reason = null
        update.semantic_override_source = 'user'
      } else {
        const { data: original, error: originalError } = await supabase
          .from('transactions')
          .select('id, user_id, category_id, date')
          .eq('id', requestedLinkedId)
          .eq('user_id', user.id)
          .single()

        if (originalError || !original) {
          return Response.json(
            { error: 'Linked transaction not found' },
            { status: 404 }
          )
        }

        const refundedCategory = await getOrCreateRefundedCategory(
          supabase,
          user.id
        )

        const normalized = normalizeTransactionSemantics({
          treatment: 'refund',
          refundSource:
            requestedRefundSource ??
            transaction.refund_source ??
            (transaction.transaction_kind === 'reimbursement'
              ? 'reimbursement'
              : 'merchant_refund'),
          amount: transaction.amount,
        })

        update.treatment = normalized.treatment
        update.refund_source = normalized.refundSource
        update.transaction_kind = normalized.transactionKind
        update.budget_behavior = normalized.budgetBehavior
        update.linked_transaction_id = original.id
        update.category_id = refundedCategory?.id ?? original.category_id
        update.budget_effective_date = original.date
        update.refund_match_confidence = null
        update.refund_match_reason = 'manual link'
        update.semantic_override_source = 'user'
      }
    }

    if (requestedReviewed) {
      update.semantic_override_source = 'user'
      if (!update.treatment) {
        const normalized = normalizeTransactionSemantics({
          treatment: currentTreatment === 'refund' ? currentTreatment : 'refund',
          refundSource:
            requestedRefundSource ??
            transaction.refund_source ??
            (transaction.transaction_kind === 'reimbursement'
              ? 'reimbursement'
              : 'merchant_refund'),
          amount: transaction.amount,
          category: transactionCategory,
        })
        update.treatment = normalized.treatment
        update.refund_source = normalized.refundSource
        update.transaction_kind = normalized.transactionKind
        update.budget_behavior = normalized.budgetBehavior
      }
      update.budget_effective_date = update.budget_effective_date ?? transaction.date
      update.refund_match_confidence = null
      update.refund_match_reason = MANUAL_REVIEWED_REFUND_REASON
    }

    if (
      isTransactionTreatment(update.treatment as string | undefined) &&
      update.treatment !== 'refund'
    ) {
      update.linked_transaction_id = null
      update.refund_source = null
      update.budget_effective_date = transaction.date
      update.refund_match_confidence = null
      update.refund_match_reason = null
    } else if (update.treatment === 'refund') {
      update.budget_effective_date = update.budget_effective_date ?? transaction.date
    }

    if (Object.keys(update).length === 0) {
      return Response.json({ error: 'No refund metadata updates provided' }, { status: 400 })
    }

    const { data: updated, error: updateError } = await supabase
      .from('transactions')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
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
      if (updateError) {
        console.error('Refund metadata update failed', {
          transactionId: id,
          userId: user.id,
          update,
          error: updateError,
        })
      }
      return Response.json(
        { error: 'Failed to update refund metadata' },
        { status: 500 }
      )
    }

    return Response.json({ success: true, transaction: updated })
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to update refund metadata'

    return Response.json({ error: errorMessage }, { status: 500 })
  }
}
