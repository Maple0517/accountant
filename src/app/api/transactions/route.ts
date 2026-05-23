import { createClient } from '@/lib/supabase/server'

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


    let transactionsQuery = supabase
      .from('transactions')
      .select(
        `
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
        `,
        { count: 'exact' }
      )
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (search) {
      const escapedSearch = search.replace(/[%,]/g, '')
      transactionsQuery = transactionsQuery.or(
        `merchant_name.ilike.%${escapedSearch}%,description.ilike.%${escapedSearch}%`
      )
    }
    if (sourceOrAccount === 'manual') {
      transactionsQuery = transactionsQuery.eq('source', 'manual')
    } else if (sourceOrAccount === 'receipt') {
      transactionsQuery = transactionsQuery.eq('source', 'receipt')
    } else if (sourceOrAccount.startsWith('account:')) {
      transactionsQuery = transactionsQuery.eq(
        'account_id',
        sourceOrAccount.slice('account:'.length)
      )
    }
    if (category === 'uncategorized') {
      transactionsQuery = transactionsQuery.is('category_id', null)
    } else if (category !== 'all') {
      transactionsQuery = transactionsQuery.eq('category_id', category)
    }
    if (currency !== 'all') {
      transactionsQuery = transactionsQuery.eq('iso_currency_code', currency)
    }
    if (dateFrom) {
      transactionsQuery = transactionsQuery.gte('date', dateFrom)
    }
    if (dateTo) {
      transactionsQuery = transactionsQuery.lte('date', dateTo)
    }

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

    const transactions = (transactionsResult.data || []).map((tx) => {
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

    return Response.json({
      transactions,
      totalCount: transactionsResult.count || 0,
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
