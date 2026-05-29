import { createClient } from '@/lib/supabase/server'
import {
  applyBaseFilters,
  applySavedViewFilters,
  parsePositiveInt,
  SAVED_VIEWS,
  loadSavedViewCounts,
  countAllPendingAiClassifications,
  type SavedView,
  type TransactionFilterQuery,
} from '@/lib/transactions/list-filters'

import type { Category, Transaction } from '@/types'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

type TransactionAccountRelation = {
  id?: string | null
  name?: string | null
  official_name?: string | null
  type?: string | null
  subtype?: string | null
  mask?: string | null
  is_manual?: boolean | null
  plaid_items?: {
    institution_name?: string | null
    institution_id?: string | null
  } | null
}


function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function normalizeAccountRelation(
  account: TransactionAccountRelation | null
): TransactionAccountRelation | null {
  if (!account) return null

  return {
    ...account,
    plaid_items: normalizeRelation(account.plaid_items),
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parsePositiveInt(searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT)
    const offset = parsePositiveInt(searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER)
    const search = searchParams.get('search')?.trim() || ''
    const sourceOrAccount = searchParams.get('sourceOrAccount') || 'all'
    const category = searchParams.get('category') || 'all'
    const currency = searchParams.get('currency') || 'all'
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo = searchParams.get('dateTo') || ''
    const showHidden = searchParams.get('showHidden') === 'true'
    const showDeleted = searchParams.get('showDeleted') === 'true'
    const showSplitParents = searchParams.get('showSplitParents') === 'true'
    const splitGroupId = searchParams.get('splitGroupId') || ''
    const tx = searchParams.get('tx') || ''
    const savedViewParam = searchParams.get('savedView') || 'all'
    const savedView: SavedView = isSavedView(savedViewParam) ? savedViewParam : 'all'
    const includeViewCounts = searchParams.get('includeViewCounts') === 'true'

    const filterContext = {
      userId: user.id,
      search,
      sourceOrAccount,
      category,
      currency,
      dateFrom,
      dateTo,
      showHidden,
      showDeleted,
      showSplitParents,
      splitGroupId,
      tx,
    }

    const transactionsQuery = applySavedViewFilters(
      applyBaseFilters(
        supabase
          .from('transactions')
          .select(TRANSACTION_SELECT, { count: 'exact' }) as unknown as TransactionFilterQuery,
        filterContext
      ),
      savedView
    )
      .order('effective_date', { ascending: false })
      .order('date', { ascending: false })
      .range(offset, offset + limit - 1)

    const [transactionsResult, categoriesResult, accountsResult] =
      await Promise.all([
        transactionsQuery,
        supabase
          .from('categories')
          .select('id, user_id, name, name_zh, icon, color, type, is_excluded_from_budget, sort_order, created_at')
          .eq('user_id', user.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('accounts')
          .select(
            `
              id,
              name,
              official_name,
              type,
              subtype,
              mask,
              is_manual,
              archived_at,
              archived_reason,
              plaid_items (
                institution_name,
                institution_id
              )
            `
          )
          .eq('user_id', user.id)
          .is('archived_at', null)
          .order('created_at', { ascending: true }),
      ])

    if (transactionsResult.error) {
      console.error('Error fetching transactions:', transactionsResult.error)
      return Response.json({ error: 'Failed to fetch transactions' }, { status: 500 })
    }
    if (categoriesResult.error) {
      console.error('Error fetching transaction categories:', categoriesResult.error)
      return Response.json({ error: 'Failed to fetch categories' }, { status: 500 })
    }
    if (accountsResult.error) {
      console.error('Error fetching account filters:', accountsResult.error)
      return Response.json({ error: 'Failed to fetch accounts' }, { status: 500 })
    }

    const transactions = (transactionsResult.data || []).map((tx: unknown) => {
      const row = tx as unknown as Transaction & {
        accounts?: TransactionAccountRelation | TransactionAccountRelation[] | null
        categories?:
          | Pick<
              Category,
              'id' | 'name' | 'name_zh' | 'icon' | 'color' | 'is_excluded_from_budget'
            >
          | Array<
              Pick<
                Category,
                'id' | 'name' | 'name_zh' | 'icon' | 'color' | 'is_excluded_from_budget'
              >
            >
          | null
      }

      return {
        ...row,
        accounts: normalizeAccountRelation(normalizeRelation(row.accounts)),
        categories: normalizeRelation(row.categories),
      }
    })

    const [viewCounts, allAiPendingCount] = await Promise.all([
      includeViewCounts
        ? loadSavedViewCounts(supabase as never, filterContext)
        : Promise.resolve(undefined),
      countAllPendingAiClassifications(supabase as never, user.id),
    ])

    return Response.json({
      transactions,
      totalCount: transactionsResult.count || 0,
      viewCounts,
      allAiPendingCount,
      categories: (categoriesResult.data || []) as Category[],
      accounts: ((accountsResult.data || []) as TransactionAccountRelation[])
        .map((account) => normalizeAccountRelation(account))
        .filter((account): account is TransactionAccountRelation => Boolean(account)),
      limit,
      offset,
    })
  } catch (error: unknown) {
    console.error('Error in transactions API:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to fetch transactions'
    return Response.json({ error: errorMessage }, { status: 500 })
  }
}

const TRANSACTION_SELECT = `
  id,
  user_id,
  account_id,
  amount,
  iso_currency_code,
  date,
  merchant_name,
  description,
  pending,
  source,
  category_id,
  tags,
  transaction_kind,
  budget_behavior,
      linked_transaction_id,
      budget_effective_date,
  effective_date,
  deleted_at,
  deleted_reason,
  is_hidden_from_reports,
  split_group_id,
  split_parent_id,
  split_role,
  split_sequence,
  split_status,
  refund_match_confidence,
  refund_match_reason,
  transfer_match_status,
  transfer_match_reason,
  created_at,
  updated_at,
  accounts!transactions_account_id_fkey (
    id,
    name,
    official_name,
    type,
    subtype,
    mask,
    is_manual,
    plaid_items (
      institution_name,
      institution_id
    )
  ),
  categories!transactions_category_id_fkey (
    id,
    name,
    name_zh,
    icon,
    color,
    is_excluded_from_budget
  )
`

function isSavedView(value: string): value is SavedView {
  return SAVED_VIEWS.includes(value as SavedView)
}
