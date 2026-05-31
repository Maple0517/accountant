import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateRefundedCategory } from '@/lib/categories-db'
import { getTransactionMutationBlockReason } from '@/lib/transactions/mutation-guard'
import { deriveBudgetBehavior } from '@/lib/transactions/semantics'
import { MANUAL_REVIEWED_REFUND_REASON } from '@/lib/transactions/review'
import type { TransactionKind } from '@/types'

export const dynamic = 'force-dynamic'

const VALID_KINDS = new Set<TransactionKind>([
  'normal',
  'refund',
  'reimbursement',
  'transfer',
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
        category_id,
        transaction_kind,
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

    if (requestedKind) {
      update.transaction_kind = requestedKind
      update.budget_behavior = deriveBudgetBehavior({
        transactionKind: requestedKind,
        category: transactionCategory,
      })
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

        const linkedKind =
          requestedKind ??
          (transaction.transaction_kind === 'reimbursement'
            ? 'reimbursement'
            : 'refund')

        update.transaction_kind = linkedKind
        update.budget_behavior = 'count_as_spending'
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
      if (!update.transaction_kind) {
        update.transaction_kind = transaction.transaction_kind || 'refund'
      }
      if (!update.budget_behavior) {
        update.budget_behavior = deriveBudgetBehavior({
          transactionKind: update.transaction_kind as TransactionKind,
          category: transactionCategory,
        })
      }
      update.budget_effective_date = update.budget_effective_date ?? transaction.date
      update.refund_match_confidence = null
      update.refund_match_reason = MANUAL_REVIEWED_REFUND_REASON
    }

    if (update.transaction_kind === 'normal') {
      update.linked_transaction_id = null
      update.budget_behavior = deriveBudgetBehavior({
        transactionKind: 'normal',
        category: transactionCategory,
      })
      update.budget_effective_date = transaction.date
      update.refund_match_confidence = null
      update.refund_match_reason = null
    } else if (
      update.transaction_kind === 'refund' ||
      update.transaction_kind === 'reimbursement'
    ) {
      update.budget_behavior = 'count_as_spending'
      update.budget_effective_date = update.budget_effective_date ?? transaction.date
    } else if (update.transaction_kind === 'transfer') {
      update.budget_behavior = 'exclude_as_transfer'
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
