import type { SavedView } from '@/lib/transactions/list-filters'

type BuildTransactionsQueryParamsInput = {
  limit: number
  offset: number
  sourceOrAccount: string
  category: string
  currency: string
  savedView: SavedView
  search: string
  dateFrom: string
  dateTo: string
  tx: string
  includeViewCounts: boolean
}

export function buildTransactionsQueryParams(
  input: BuildTransactionsQueryParamsInput
) {
  const params = new URLSearchParams({
    limit: String(input.limit),
    offset: String(input.offset),
    sourceOrAccount: input.sourceOrAccount,
    category: input.category,
    currency: input.currency,
    savedView: input.savedView,
  })

  if (input.search) params.set('search', input.search)
  if (input.dateFrom) params.set('dateFrom', input.dateFrom)
  if (input.dateTo) params.set('dateTo', input.dateTo)
  if (input.tx) params.set('tx', input.tx)
  if (input.includeViewCounts) params.set('includeViewCounts', 'true')

  return params
}
