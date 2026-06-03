import { AI_PENDING_TAG, PLAID_FALLBACK_TAG } from '@/lib/plaid/classification'
import {
  MANUAL_REVIEWED_REFUND_REASON,
} from '@/lib/transactions/review'

export type SavedView =
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

type TransactionListCounts = {
  viewCounts: Record<SavedView, number>
  allAiPendingCount: number
}

type TransactionListCountsRpcResult = {
  view_counts?: Record<string, unknown> | null
  all_ai_pending_count?: unknown
}

export type TransactionFilterQuery = PromiseLike<TransactionQueryResult> & {
  eq(column: string, value: unknown): TransactionFilterQuery
  neq(column: string, value: unknown): TransactionFilterQuery
  or(filters: string): TransactionFilterQuery
  is(column: string, value: null): TransactionFilterQuery
  in(column: string, values: readonly unknown[]): TransactionFilterQuery
  gte(column: string, value: unknown): TransactionFilterQuery
  lte(column: string, value: unknown): TransactionFilterQuery
  order(column: string, options: { ascending: boolean }): TransactionFilterQuery
  range(from: number, to: number): TransactionFilterQuery
}

export function parsePositiveInt(value: string | null, fallback: number, max: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return fallback
  return Math.min(parsed, max)
}

export const SAVED_VIEWS: SavedView[] = [
  'all',
  'needs_review',
  'uncategorized',
  'ai_pending',
  'refunds',
  'transfers',
  'pending',
  'large',
]

export function applyBaseFilters(
  query: TransactionFilterQuery,
  {
    userId,
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
  }: {
    userId: string
    search: string
    sourceOrAccount: string
    category: string
    currency: string
    dateFrom: string
    dateTo: string
    showHidden: boolean
    showDeleted: boolean
    showSplitParents: boolean
    splitGroupId: string
    tx?: string
  }
) {
  let nextQuery = query.eq('user_id', userId)

  if (!showDeleted) {
    nextQuery = nextQuery.is('deleted_at', null)
  }
  if (!showHidden) {
    nextQuery = nextQuery.eq('is_hidden_from_reports', false)
  }
  if (!showSplitParents) {
    nextQuery = nextQuery.neq('split_role', 'parent')
  }
  if (splitGroupId) {
    nextQuery = nextQuery.eq('split_group_id', splitGroupId)
  }
  if (tx) {
    return nextQuery.eq('id', tx)
  }

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
    nextQuery = nextQuery.gte('effective_date', dateFrom)
  }
  if (dateTo) {
    nextQuery = nextQuery.lte('effective_date', dateTo)
  }

  return nextQuery
}

export function applySavedViewFilters(
  query: TransactionFilterQuery,
  savedView: SavedView
) {
  switch (savedView) {
    case 'needs_review':
      return query.eq('pending', false).or(
        `category_id.is.null,tags.cs.{"${AI_PENDING_TAG}"},tags.cs.{"${PLAID_FALLBACK_TAG}"},and(treatment.eq.refund,linked_transaction_id.is.null,or(refund_match_reason.is.null,refund_match_reason.neq.${MANUAL_REVIEWED_REFUND_REASON})),and(treatment.eq.transfer,or(transfer_match_status.is.null,transfer_match_status.in.(unmatched,suggested)))`
      )
    case 'uncategorized':
      return query.is('category_id', null)
    case 'ai_pending':
      return query.or(
        `tags.cs.{"${AI_PENDING_TAG}"},tags.cs.{"${PLAID_FALLBACK_TAG}"}`
      )
    case 'refunds':
      return query.eq('treatment', 'refund')
    case 'transfers':
      return query.or('treatment.eq.transfer,transfer_match_status.not.is.null')
    case 'pending':
      return query.eq('pending', true)
    case 'large':
      return query.or('amount.gte.100,amount.lte.-100')
    case 'all':
    default:
      return query
  }
}

export async function countSavedView(
  supabase: {
    from(table: string): {
      select(
        columns: string,
        options?: { count?: 'exact'; head?: boolean }
      ): TransactionFilterQuery
    }
  },
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

function buildDefaultSavedViewCounts() {
  return Object.fromEntries(SAVED_VIEWS.map((view) => [view, 0])) as Record<
    SavedView,
    number
  >
}

function normalizeRpcListCounts(data: unknown): TransactionListCounts | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const raw = data as TransactionListCountsRpcResult
  const rawViewCounts = raw.view_counts
  if (!rawViewCounts || typeof rawViewCounts !== 'object') {
    return null
  }

  const viewCounts = buildDefaultSavedViewCounts()
  for (const view of SAVED_VIEWS) {
    const value = rawViewCounts[view]
    viewCounts[view] =
      typeof value === 'number' && Number.isFinite(value) ? value : Number(value || 0)
  }

  const allAiPendingCount = Number(raw.all_ai_pending_count || 0)
  return {
    viewCounts,
    allAiPendingCount: Number.isFinite(allAiPendingCount) ? allAiPendingCount : 0,
  }
}

function isMissingRpcError(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === 'PGRST202' ||
    Boolean(error?.message?.includes('get_transaction_list_counts')) ||
    Boolean(error?.message?.includes('Could not find the function'))
  )
}

async function loadSavedViewCountsFallback(
  supabase: Parameters<typeof countSavedView>[0],
  filterContext: Parameters<typeof applyBaseFilters>[1]
) {
  const entries = await Promise.all(
    SAVED_VIEWS.map(async (view) =>
      [view, await countSavedView(supabase, filterContext, view)] as const
    )
  )

  return Object.fromEntries(entries) as Record<SavedView, number>
}

export async function loadTransactionListCounts(
  supabase: Parameters<typeof countSavedView>[0] & {
    rpc?: (
      fn: string,
      params: Record<string, unknown>
    ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
  },
  filterContext: Parameters<typeof applyBaseFilters>[1]
): Promise<TransactionListCounts> {
  if (typeof supabase.rpc === 'function') {
    const { data, error } = await supabase.rpc('get_transaction_list_counts', {
      p_user_id: filterContext.userId,
      p_search: filterContext.search,
      p_source_or_account: filterContext.sourceOrAccount,
      p_category: filterContext.category,
      p_currency: filterContext.currency,
      p_date_from: filterContext.dateFrom,
      p_date_to: filterContext.dateTo,
      p_show_hidden: filterContext.showHidden,
      p_show_deleted: filterContext.showDeleted,
      p_show_split_parents: filterContext.showSplitParents,
      p_split_group_id: filterContext.splitGroupId,
      p_tx: filterContext.tx ?? '',
    })

    if (!error) {
      const normalized = normalizeRpcListCounts(data)
      if (normalized) {
        return normalized
      }
      console.warn('Transaction list count RPC returned unexpected shape:', data)
    } else if (!isMissingRpcError(error)) {
      console.warn('Transaction list count RPC failed, falling back to head counts:', error)
    }
  }

  const [viewCounts, allAiPendingCount] = await Promise.all([
    loadSavedViewCountsFallback(supabase, filterContext),
    countAllPendingAiClassifications(supabase, filterContext.userId),
  ])

  return { viewCounts, allAiPendingCount }
}

export async function loadSavedViewCounts(
  supabase: Parameters<typeof countSavedView>[0],
  filterContext: Parameters<typeof applyBaseFilters>[1]
) {
  return (await loadTransactionListCounts(supabase, filterContext)).viewCounts
}

export async function countAllPendingAiClassifications(
  supabase: Parameters<typeof countSavedView>[0],
  userId: string
) {
  return countSavedView(
    supabase,
    {
      userId,
      search: '',
      sourceOrAccount: 'all',
      category: 'all',
      currency: 'all',
      dateFrom: '',
      dateTo: '',
      showHidden: false,
      showDeleted: false,
      showSplitParents: false,
      splitGroupId: '',
      tx: '',
    },
    'ai_pending'
  )
}
