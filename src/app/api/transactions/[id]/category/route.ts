import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripAutomaticClassificationTags } from '@/lib/plaid/classification'
import {
  canApplySimilarCategoryUpdate,
  getTransactionMutationBlockReason,
} from '@/lib/transactions/mutation-guard'
import { shouldPreserveBudgetBehavior } from '@/lib/transactions/semantics'
import { normalizeTransactionSemantics } from '@/lib/transactions/treatment'

export const dynamic = 'force-dynamic'

type SimilarMode = 'single' | 'similar'


function normalizeMatchKey(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase('en-US') || ''
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
    const categoryId = typeof body.category_id === 'string' ? body.category_id : ''
    const mode: SimilarMode = body.apply_mode === 'similar' ? 'similar' : 'single'

    if (!categoryId) {
      return Response.json({ error: 'category_id is required' }, { status: 400 })
    }

    const [{ data: transaction, error: transactionError }, { data: category, error: categoryError }] =
      await Promise.all([
        supabase
          .from('transactions')
          .select('id, user_id, category_id, tags, merchant_name, description, source, treatment, refund_source, transaction_kind, budget_behavior, semantic_override_source, deleted_at, is_hidden_from_reports, split_role, split_group_id, split_parent_id')
          .eq('id', id)
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('categories')
          .select('id, user_id, name, name_zh, icon, color, type, is_excluded_from_budget')
          .eq('id', categoryId)
          .eq('user_id', user.id)
          .single(),
      ])

    if (transactionError || !transaction) {
      return Response.json({ error: 'Transaction not found' }, { status: 404 })
    }

    if (categoryError || !category) {
      return Response.json({ error: 'Category not found' }, { status: 404 })
    }

    const blockReason = getTransactionMutationBlockReason(transaction)
    if (blockReason) {
      return Response.json({ error: blockReason }, { status: 409 })
    }
    if (mode === 'similar' && !canApplySimilarCategoryUpdate(transaction)) {
      return Response.json(
        { error: 'Apply similar is disabled for split transactions' },
        { status: 409 }
      )
    }

    const matchKey = normalizeMatchKey(transaction.merchant_name || transaction.description)
    let similarCount = 0
    let updatedCount = 0

    if (mode === 'similar') {
      const { data: candidates, error: candidatesError } = await supabase
        .from('transactions')
        .select('id, tags, merchant_name, description, treatment, refund_source, transaction_kind, budget_behavior, semantic_override_source')
        .eq('user_id', user.id)
        .eq('source', transaction.source)
        .is('deleted_at', null)
        .eq('is_hidden_from_reports', false)
        .neq('split_role', 'child')
        .neq('split_role', 'parent')

      if (candidatesError) {
        return Response.json(
          { error: 'Failed to load similar transactions' },
          { status: 500 }
        )
      }

      const similarTransactions = (candidates || []).filter((candidate) => {
        const candidateKey = normalizeMatchKey(
          candidate.merchant_name || candidate.description
        )
        return candidateKey !== '' && candidateKey === matchKey
      })

      similarCount = Math.max(0, similarTransactions.length - 1)

      const updates = await Promise.all(
        similarTransactions.map(async (candidate) => {
          const tags = stripAutomaticClassificationTags(candidate.tags)
          const updatePayload: Record<string, unknown> = {
            category_id: categoryId,
            tags,
          }

          if (!shouldPreserveBudgetBehavior(candidate.semantic_override_source)) {
            const semantics = normalizeTransactionSemantics({
              treatment: candidate.treatment,
              refundSource: candidate.refund_source,
              transactionKind: candidate.transaction_kind,
              budgetBehavior: candidate.budget_behavior,
              category,
            })
            updatePayload.treatment = semantics.treatment
            updatePayload.refund_source = semantics.refundSource
            updatePayload.transaction_kind = semantics.transactionKind
            updatePayload.budget_behavior = semantics.budgetBehavior
            updatePayload.semantic_override_source = 'user'
          }

          const { error: updateError } = await supabase
            .from('transactions')
            .update(updatePayload)
            .eq('id', candidate.id)
            .eq('user_id', user.id)
            .is('deleted_at', null)
            .eq('is_hidden_from_reports', false)
            .neq('split_role', 'child')
            .neq('split_role', 'parent')

          return updateError ? 0 : 1
        })
      )
      updatedCount = updates.reduce<number>((sum, value) => sum + value, 0)
    } else {
      const tags = stripAutomaticClassificationTags(transaction.tags)
      const updatePayload: Record<string, unknown> = {
        category_id: categoryId,
        tags,
      }

      if (!shouldPreserveBudgetBehavior(transaction.semantic_override_source)) {
        const semantics = normalizeTransactionSemantics({
          treatment: transaction.treatment,
          refundSource: transaction.refund_source,
          transactionKind: transaction.transaction_kind,
          budgetBehavior: transaction.budget_behavior,
          category,
        })
        updatePayload.treatment = semantics.treatment
        updatePayload.refund_source = semantics.refundSource
        updatePayload.transaction_kind = semantics.transactionKind
        updatePayload.budget_behavior = semantics.budgetBehavior
        updatePayload.semantic_override_source = 'user'
      }

      const { error: updateError } = await supabase
        .from('transactions')
        .update(updatePayload)
        .eq('id', id)
        .eq('user_id', user.id)

      if (updateError) {
        console.error('Category update failed', {
          transactionId: id,
          userId: user.id,
          categoryId,
          mode,
          updatePayload,
          error: updateError,
        })
        return Response.json(
          { error: 'Failed to update transaction category' },
          { status: 500 }
        )
      }

      updatedCount = 1

      const { data: candidates, error: candidatesError } = await supabase
        .from('transactions')
        .select('id, merchant_name, description')
        .eq('user_id', user.id)
        .eq('source', transaction.source)
        .is('deleted_at', null)
        .eq('is_hidden_from_reports', false)
        .neq('split_role', 'child')
        .neq('split_role', 'parent')

      if (!candidatesError) {
        similarCount = Math.max(
          0,
          (candidates || []).reduce<number>((count, candidate) => {
            const candidateKey = normalizeMatchKey(
              candidate.merchant_name || candidate.description
            )
            return candidate.id !== id && candidateKey !== '' && candidateKey === matchKey
              ? count + 1
              : count
          }, 0)
        )
      }
    }

    return Response.json({
      success: true,
      transaction: {
        id,
        category_id: categoryId,
        categories: category,
      },
      similar_count: similarCount,
      updated_count: updatedCount,
    })
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to update transaction category'

    return Response.json({ error: errorMessage }, { status: 500 })
  }
}
