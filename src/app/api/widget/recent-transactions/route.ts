import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  authenticateWithApiKey,
  extractBearerToken,
  markApiKeyUsed,
} from '@/lib/api-key-auth'

import type { TransactionKind } from '@/types'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 7
const MAX_LIMIT = 10

type WidgetAuth = {
  userId: string
  apiKeyId?: string
}

type WidgetAccountRelation = {
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

type WidgetCategoryRelation = {
  id?: string | null
  name?: string | null
  name_zh?: string | null
  icon?: string | null
  color?: string | null
  type?: 'income' | 'expense' | 'transfer' | null
  is_excluded_from_budget?: boolean | null
}

type WidgetPlaidItemSyncRow = {
  last_synced_at?: string | null
}

type WidgetTransactionRow = {
  id: string
  amount: number
  iso_currency_code?: string | null
  date?: string | null
  effective_date?: string | null
  merchant_name?: string | null
  description?: string | null
  pending?: boolean | null
  source?: string | null
  transaction_kind?: TransactionKind | null
  budget_behavior?: string | null
  created_at?: string | null
  updated_at?: string | null
  accounts?: WidgetAccountRelation | WidgetAccountRelation[] | null
  categories?: WidgetCategoryRelation | WidgetCategoryRelation[] | null
}

type WidgetTransactionKind = TransactionKind

type WidgetTransaction = {
  id: string
  merchant: string
  subtitle: string
  amount: number
  currency: string
  date: string
  dateLabel: string
  pending: boolean
  isIncome: boolean
  kind: WidgetTransactionKind
  category: {
    id: string | null
    name: string
    label: string
    icon: string | null
    color: string | null
    type: 'income' | 'expense' | 'transfer' | null
  }
}

export type WidgetRecentTransactionsResponse = {
  updatedAt: string
  lastSyncedAt: string | null
  count: number
  transactions: WidgetTransaction[]
}

export async function GET(request: Request) {
  try {
    const auth = await authenticateWidgetRequest(request)

    if (!auth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await markApiKeyUsed(auth.apiKeyId)

    const { searchParams } = new URL(request.url)
    const limit = parseLimit(searchParams.get('limit'))
    const supabase = createAdminClient()

    const [transactionsResult, syncResult] = await Promise.all([
      supabase
        .from('transactions')
        .select(WIDGET_TRANSACTION_SELECT)
        .eq('user_id', auth.userId)
        .is('deleted_at', null)
        .eq('is_hidden_from_reports', false)
        .neq('split_role', 'parent')
        .order('effective_date', { ascending: false })
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(0, limit - 1),
      supabase
        .from('plaid_items')
        .select('last_synced_at')
        .eq('user_id', auth.userId)
        .eq('status', 'active')
        .not('last_synced_at', 'is', null)
        .order('last_synced_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const { data, error } = transactionsResult

    if (error) {
      console.error('Error fetching widget transactions:', error)
      return Response.json(
        { error: 'Failed to fetch recent transactions' },
        { status: 500 }
      )
    }

    if (syncResult.error) {
      console.warn('Failed to fetch widget sync timestamp:', syncResult.error)
    }

    const transactions = ((data || []) as WidgetTransactionRow[]).map(toWidgetTransaction)
    const latestSync = syncResult.error
      ? null
      : ((syncResult.data as WidgetPlaidItemSyncRow | null)?.last_synced_at ?? null)
    const response: WidgetRecentTransactionsResponse = {
      updatedAt: new Date().toISOString(),
      lastSyncedAt: latestSync,
      count: transactions.length,
      transactions,
    }

    return Response.json(response)
  } catch (error) {
    console.error('Widget recent transactions API error:', error)
    return Response.json(
      { error: 'Failed to fetch recent transactions' },
      { status: 500 }
    )
  }
}

async function authenticateWidgetRequest(
  request: Request
): Promise<WidgetAuth | undefined> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user?.id) {
    return { userId: user.id }
  }

  const { searchParams } = new URL(request.url)
  const apiKey =
    extractBearerToken(request) ||
    searchParams.get('api_key')?.trim() ||
    searchParams.get('token')?.trim()

  if (!apiKey) return undefined

  const apiKeyAuth = await authenticateWithApiKey(apiKey)
  if (!apiKeyAuth) return undefined

  return { userId: apiKeyAuth.userId, apiKeyId: apiKeyAuth.apiKeyId }
}

function parseLimit(value: string | null) {
  if (!value) return DEFAULT_LIMIT

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return DEFAULT_LIMIT

  return Math.min(Math.max(parsed, 1), MAX_LIMIT)
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function normalizeAccountRelation(
  account: WidgetAccountRelation | null
): WidgetAccountRelation | null {
  if (!account) return null

  return {
    ...account,
    plaid_items: normalizeRelation(account.plaid_items),
  }
}

function toWidgetTransaction(row: WidgetTransactionRow): WidgetTransaction {
  const account = normalizeAccountRelation(normalizeRelation(row.accounts))
  const category = normalizeRelation(row.categories)
  const date = row.effective_date || row.date || ''
  const dateLabel = formatDateLabel(date)
  const accountDisplay = formatAccountDisplay(account)
  const merchant = row.merchant_name?.trim() || row.description?.trim() || 'Unknown merchant'
  const categoryName = category?.name?.trim() || 'Uncategorized'
  const categoryLabel = category?.name_zh?.trim() || categoryName
  const amount = Number(row.amount) || 0

  return {
    id: row.id,
    merchant,
    subtitle: `${dateLabel}, ${accountDisplay}`,
    amount,
    currency: row.iso_currency_code || 'USD',
    date,
    dateLabel,
    pending: row.pending === true,
    isIncome: amount < 0,
    kind: row.transaction_kind || 'normal',
    category: {
      id: category?.id || null,
      name: categoryName,
      label: categoryLabel,
      icon: category?.icon || null,
      color: category?.color || null,
      type: category?.type || null,
    },
  }
}

function formatAccountDisplay(account: WidgetAccountRelation | null) {
  if (!account) return 'Account'

  const base =
    account.name?.trim() ||
    account.official_name?.trim() ||
    account.plaid_items?.institution_name?.trim() ||
    'Account'
  const mask = account.mask?.trim()

  if (!mask) return base

  return `${base}\u2022\u2022${mask}`
}

function formatDateLabel(value: string) {
  if (!value) return 'Unknown date'

  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return value

  const date = new Date(year, month - 1, day)
  const today = startOfLocalDay(new Date())
  const target = startOfLocalDay(date)
  const diffDays = Math.round(
    (today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000)
  )

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

const WIDGET_TRANSACTION_SELECT = `
  id,
  amount,
  iso_currency_code,
  date,
  effective_date,
  merchant_name,
  description,
  pending,
  source,
  transaction_kind,
  budget_behavior,
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
    type,
    is_excluded_from_budget
  )
`
