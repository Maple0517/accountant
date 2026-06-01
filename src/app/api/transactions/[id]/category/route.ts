import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripAutomaticClassificationTags } from '@/lib/plaid/classification'
import { deriveCategoryChangeSemantics } from '@/lib/transactions/category-semantics'
import {
  canApplySimilarCategoryUpdate,
  getTransactionMutationBlockReason,
} from '@/lib/transactions/mutation-guard'

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
          .select('id, user_id, amount, category_id, tags, merchant_name, description, source, treatment, refund_source, semantic_override_source, transfer_group_id, transfer_match_status, transfer_match_confidence, transfer_match_reason, deleted_at, is_hidden_from_reports, split_role, split_group_id, split_parent_id')
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
    let updatedTransaction: Record<string, unknown> | null = null

    if (mode === 'similar') {
      const { data: candidates, error: candidatesError } = await supabase
        .from('transactions')
        .select('id, amount, tags, merchant_name, description, treatment, refund_source, semantic_override_source, transfer_group_id, transfer_match_status, transfer_match_confidence, transfer_match_reason')
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

          const semantics = deriveCategoryChangeSemantics({
            amount: candidate.amount,
            treatment: candidate.treatment,
            refundSource: candidate.refund_source,
            category,
          })
          updatePayload.treatment = semantics.treatment
          updatePayload.refund_source = semantics.refundSource
          updatePayload.semantic_override_source = 'user'

          if (semantics.treatment !== 'transfer') {
            updatePayload.transfer_group_id = null
            updatePayload.transfer_match_status = null
            updatePayload.transfer_match_confidence = null
            updatePayload.transfer_match_reason = null
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

      const semantics = deriveCategoryChangeSemantics({
        amount: transaction.amount,
        treatment: transaction.treatment,
        refundSource: transaction.refund_source,
        category,
      })
      updatePayload.treatment = semantics.treatment
      updatePayload.refund_source = semantics.refundSource
      updatePayload.semantic_override_source = 'user'

      if (semantics.treatment !== 'transfer') {
        updatePayload.transfer_group_id = null
        updatePayload.transfer_match_status = null
        updatePayload.transfer_match_confidence = null
        updatePayload.transfer_match_reason = null
      }

      const { data: singleUpdatedTransaction, error: updateError } = await supabase
        .from('transactions')
        .update(updatePayload)
        .eq('id', id)
        .eq('user_id', user.id)
        .select('id, category_id, tags, treatment, refund_source, semantic_override_source, transfer_group_id, transfer_match_status, transfer_match_confidence, transfer_match_reason, linked_transaction_id, budget_effective_date, refund_match_confidence, refund_match_reason, categories!transactions_category_id_fkey ( id, name, name_zh, icon, color, is_excluded_from_budget )')
        .single()

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

      updatedTransaction = (singleUpdatedTransaction as Record<string, unknown> | null) ?? null
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
      transaction:
        mode === 'single'
          ? updatedTransaction
          : {
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
