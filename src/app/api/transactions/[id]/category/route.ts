import { createClient } from '@/lib/supabase/server'
import { stripAutomaticClassificationTags } from '@/lib/plaid/classification'
import { deriveBudgetBehavior } from '@/lib/transactions/semantics'

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
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
          .select('id, user_id, category_id, tags, merchant_name, description, source, transaction_kind')
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

    const matchKey = normalizeMatchKey(transaction.merchant_name || transaction.description)
    let similarCount = 0
    let updatedCount = 0

    if (mode === 'similar') {
      const { data: candidates, error: candidatesError } = await supabase
        .from('transactions')
        .select('id, tags, merchant_name, description, transaction_kind')
        .eq('user_id', user.id)
        .eq('source', transaction.source)

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
          const { error: updateError } = await supabase
            .from('transactions')
            .update({
              category_id: categoryId,
              budget_behavior: deriveBudgetBehavior({
                transactionKind: candidate.transaction_kind,
                category,
              }),
              semantic_override_source: 'user',
              tags,
            })
            .eq('id', candidate.id)
            .eq('user_id', user.id)

          return updateError ? 0 : 1
        })
      )
      updatedCount = updates.reduce<number>((sum, value) => sum + value, 0)
    } else {
      const tags = stripAutomaticClassificationTags(transaction.tags)
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          category_id: categoryId,
          budget_behavior: deriveBudgetBehavior({
            transactionKind: transaction.transaction_kind,
            category,
          }),
          semantic_override_source: 'user',
          tags,
        })
        .eq('id', id)
        .eq('user_id', user.id)

      if (updateError) {
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
