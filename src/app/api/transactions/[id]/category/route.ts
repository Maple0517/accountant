import { createClient } from '@/lib/supabase/server'
import {
  AI_CLASSIFIED_TAG,
  AI_PENDING_TAG,
  PLAID_FALLBACK_TAG,
} from '@/lib/plaid/classification'

export const dynamic = 'force-dynamic'

type SimilarMode = 'single' | 'similar'

function stripAutomaticClassificationTags(tags: string[] | null | undefined) {
  return (tags || []).filter(
    (tag) =>
      tag !== AI_CLASSIFIED_TAG &&
      tag !== AI_PENDING_TAG &&
      tag !== PLAID_FALLBACK_TAG
  )
}

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
          .select('id, user_id, category_id, tags, merchant_name, description, source')
          .eq('id', id)
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('categories')
          .select('id, user_id, name, name_zh, icon, color, is_excluded_from_budget')
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
        .select('id, tags, merchant_name, description')
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

      for (const candidate of similarTransactions) {
        const tags = stripAutomaticClassificationTags(candidate.tags)
        const { error: updateError } = await supabase
          .from('transactions')
          .update({
            category_id: categoryId,
            tags,
          })
          .eq('id', candidate.id)
          .eq('user_id', user.id)

        if (!updateError) {
          updatedCount += 1
        }
      }
    } else {
      const tags = stripAutomaticClassificationTags(transaction.tags)
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          category_id: categoryId,
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
          (candidates || []).filter((candidate) => {
            const candidateKey = normalizeMatchKey(
              candidate.merchant_name || candidate.description
            )
            return candidate.id !== id && candidateKey !== '' && candidateKey === matchKey
          }).length
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
