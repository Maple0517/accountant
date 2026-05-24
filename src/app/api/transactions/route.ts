import { createClient } from '@/lib/supabase/server'

import {
  AI_PENDING_TAG,
  PLAID_FALLBACK_TAG,
} from '@/lib/plaid/classification'
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

type SavedView =
  | 'all'
  | 'needs_review'
  | 'uncategorized'
  | 'ai_pending'
  | 'refunds'
  | 'transfers'
  | 'pending'
  | 'large'

type TransactionQueryResult = {
  data: unknown[] | null
  count?: number | null
  error: { message?: string } | null
}

type TransactionFilterQuery = PromiseLike<TransactionQueryResult> & {
  eq(column: string, value: unknown): TransactionFilterQuery
  or(filters: string): TransactionFilterQuery
  is(column: string, value: null): TransactionFilterQuery
  in(column: string, values: readonly unknown[]): TransactionFilterQuery
  gte(column: string, value: unknown): TransactionFilterQuery
  lte(column: string, value: unknown): TransactionFilterQuery
  order(column: string, options: { ascending: boolean }): TransactionFilterQuery
  range(from: number, to: number): TransactionFilterQuery
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return fallback
  return Math.min(parsed, max)
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
    const savedViewParam = searchParams.get('savedView') || 'all'
    const savedView: SavedView = isSavedView(savedViewParam) ? savedViewParam : 'all'

    const filterContext = {
      userId: user.id,
      search,
      sourceOrAccount,
      category,
      currency,
      dateFrom,
      dateTo,
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
              plaid_items (
                institution_name,
                institution_id
              )
            `
          )
          .eq('user_id', user.id)
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

    const viewCounts = await loadSavedViewCounts(supabase, filterContext)

    return Response.json({
      transactions,
      totalCount: transactionsResult.count || 0,
      viewCounts,
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

const SAVED_VIEWS: SavedView[] = [
  'all',
  'needs_review',
  'uncategorized',
  'ai_pending',
  'refunds',
  'transfers',
  'pending',
  'large',
]

function isSavedView(value: string): value is SavedView {
  return SAVED_VIEWS.includes(value as SavedView)
}

function applyBaseFilters(
  query: TransactionFilterQuery,
  {
    userId,
    search,
    sourceOrAccount,
    category,
    currency,
    dateFrom,
    dateTo,
  }: {
    userId: string
    search: string
    sourceOrAccount: string
    category: string
    currency: string
    dateFrom: string
    dateTo: string
  }
) {
  let nextQuery = query.eq('user_id', userId)

  if (search) {
    const escapedSearch = search.replace(/[%,]/g, '')
    nextQuery = nextQuery.or(
      `merchant_name.ilike.%${escapedSearch}%,description.ilike.%${escapedSearch}%`
    )
  }
  if (sourceOrAccount === 'manual') {
    nextQuery = nextQuery.eq('source', 'manual')
  } else if (sourceOrAccount === 'receipt') {
    nextQuery = nextQuery.eq('source', 'receipt')
  } else if (sourceOrAccount.startsWith('account:')) {
    nextQuery = nextQuery.eq('account_id', sourceOrAccount.slice('account:'.length))
  }
  if (category === 'uncategorized') {
    nextQuery = nextQuery.is('category_id', null)
  } else if (category !== 'all') {
    nextQuery = nextQuery.eq('category_id', category)
  }
  if (currency !== 'all') {
    nextQuery = nextQuery.eq('iso_currency_code', currency)
  }
  if (dateFrom) {
    nextQuery = nextQuery.gte('date', dateFrom)
  }
  if (dateTo) {
    nextQuery = nextQuery.lte('date', dateTo)
  }

  return nextQuery
}

function applySavedViewFilters(
  query: TransactionFilterQuery,
  savedView: SavedView
) {
  switch (savedView) {
    case 'needs_review':
      return query.or(
        `category_id.is.null,tags.cs.{"${AI_PENDING_TAG}"},tags.cs.{"${PLAID_FALLBACK_TAG}"},pending.eq.true,transaction_kind.in.(refund,reimbursement),and(transaction_kind.eq.transfer,or(transfer_match_status.is.null,transfer_match_status.in.(unmatched,suggested)))`
      )
    case 'uncategorized':
      return query.is('category_id', null)
    case 'ai_pending':
      return query.or(
        `tags.cs.{"${AI_PENDING_TAG}"},tags.cs.{"${PLAID_FALLBACK_TAG}"}`
      )
    case 'refunds':
      return query.in('transaction_kind', ['refund', 'reimbursement'])
    case 'transfers':
      return query.or('transaction_kind.eq.transfer,transfer_match_status.not.is.null')
    case 'pending':
      return query.eq('pending', true)
    case 'large':
      return query.or('amount.gte.100,amount.lte.-100')
    case 'all':
    default:
      return query
  }
}

async function countSavedView(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filterContext: Parameters<typeof applyBaseFilters>[1],
  savedView: SavedView
) {
  const { count, error } = await applySavedViewFilters(
    applyBaseFilters(
      supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true }) as unknown as TransactionFilterQuery,
      filterContext
    ),
    savedView
  )

  if (error) {
    console.warn(`Failed to count ${savedView} transactions:`, error)
    return 0
  }

  return count || 0
}

async function loadSavedViewCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filterContext: Parameters<typeof applyBaseFilters>[1]
) {
  const entries = await Promise.all(
    SAVED_VIEWS.map(async (view) => [view, await countSavedView(supabase, filterContext, view)] as const)
  )

  return Object.fromEntries(entries) as Record<SavedView, number>
}
