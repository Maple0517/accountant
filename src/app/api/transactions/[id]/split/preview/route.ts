import { createClient } from '@/lib/supabase/server'
import {
  buildSplitPreview,
  makeSplitApiError,
  normalizeSplitRequest,
  validateCanonicalSplitSigns,
} from '@/lib/transactions/split-api'
import type { Transaction } from '@/types'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      const error = makeSplitApiError('UNAUTHENTICATED', 401, 'Unauthorized')
      return Response.json(error.body, { status: error.status })
    }

    const { id } = await context.params
    const body = await request.json()
    const parsed = normalizeSplitRequest(body)
    if (!parsed.ok) {
      return Response.json(parsed.error, { status: parsed.status })
    }

    const { data, error } = await supabase
      .from('transactions')
      .select(
        `
          id,
          user_id,
          amount,
          date,
          budget_effective_date,
          effective_date,
          treatment,
          refund_source,
          transaction_kind,
          budget_behavior,
          pending,
          deleted_at,
          split_role,
          split_parent_id,
          split_status
        `
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error || !data) {
      const mapped = makeSplitApiError('NOT_FOUND', 404, 'Transaction was not found')
      return Response.json(mapped.body, { status: mapped.status })
    }

    const parent = data as Pick<
      Transaction,
      | 'amount'
      | 'date'
      | 'budget_effective_date'
      | 'effective_date'
      | 'treatment'
      | 'refund_source'
      | 'transaction_kind'
      | 'budget_behavior'
      | 'pending'
      | 'deleted_at'
      | 'split_role'
      | 'split_status'
    >

    if (parent.pending) {
      const mapped = makeSplitApiError(
        'PENDING_PARENT_NOT_SUPPORTED',
        422,
        'Pending transactions cannot be split in V1',
        ['PENDING_PARENT_NOT_SUPPORTED']
      )
      return Response.json(mapped.body, { status: mapped.status })
    }

    const categoryIds = Array.from(
      new Set(
        parsed.value.children
          .map((child) => child.category_id)
          .filter((categoryId): categoryId is string => categoryId != null)
      )
    )
    const excludedCategoryIds = new Set<string>()

    if (categoryIds.length > 0) {
      const { data: categories, error: categoryError } = await supabase
        .from('categories')
        .select('id, is_excluded_from_budget')
        .eq('user_id', user.id)
        .in('id', categoryIds)

      if (categoryError) {
        throw new Error(`Failed to load split preview categories: ${categoryError.message}`)
      }

      for (const category of categories ?? []) {
        if (category.is_excluded_from_budget === true) {
          excludedCategoryIds.add(category.id)
        }
      }
    }

    const preview = buildSplitPreview(parent, parsed.value.children, {
      excludedCategoryIds,
    })
    const signIssues = validateCanonicalSplitSigns(
      String(parent.amount),
      parsed.value.children
    )

    return Response.json({
      ...preview,
      warnings: [...preview.warnings, ...signIssues],
    })
  } catch (error) {
    console.error('Error previewing transaction split:', error)
    const mapped = makeSplitApiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to preview transaction split'
    )
    return Response.json(mapped.body, { status: mapped.status })
  }
}
