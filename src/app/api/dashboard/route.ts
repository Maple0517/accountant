import { getCurrentUser } from '@/lib/auth/server'
import { normalizeCurrencyCode } from '@/lib/money/currency'
import { getMonthlySummary } from '@/modules/budget/budget.service'
import {
  getLargestSpendingDriver,
  getMonthlySemanticAmounts,
  getReviewCounts,
} from '@/features/dashboard/dashboard-utils'
import type { DashboardMonthTransaction } from '@/features/dashboard/types'

export const dynamic = 'force-dynamic'

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function toMonthStart(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function toMonthParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function isMissingColumnError(error: { message?: string; code?: string } | null) {
  if (!error) return false
  return (
    error.code === '42703' ||
    Boolean(error.message?.includes('schema cache')) ||
    Boolean(error.message?.includes('column'))
  )
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getCurrentUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const includeBudget = searchParams.get('include') === 'full' || searchParams.get('include') === 'budget'

    const { data: profile } = await supabase
      .from('profiles')
      .select('default_currency')
      .eq('id', user.id)
      .maybeSingle()
    const currencyCode = normalizeCurrencyCode(profile?.default_currency)

    const now = new Date()
    const firstDayOfMonth = toMonthStart(now)
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const firstDayOfNextMonth = toMonthStart(nextMonthDate)
    const currentMonth = toMonthParam(now)

    const baseRequests = [
        supabase
          .from('accounts')
          .select('type, current_balance, available_balance, iso_currency_code')
          .eq('user_id', user.id)
          .is('archived_at', null),
        supabase
          .from('transactions')
          .select(
            'id, merchant_name, description, source, amount, iso_currency_code, pending, category_id, tags, treatment, refund_source, linked_transaction_id, refund_match_confidence, refund_match_reason, semantic_override_source, budget_effective_date, effective_date, date, transfer_match_status, deleted_at, is_hidden_from_reports, split_role, categories!transactions_category_id_fkey ( is_excluded_from_budget )'
          )
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .eq('is_hidden_from_reports', false)
          .neq('split_role', 'parent')
          .gte('effective_date', firstDayOfMonth)
          .lt('effective_date', firstDayOfNextMonth),
        supabase
          .from('transactions')
          .select(
            'id, merchant_name, description, amount, iso_currency_code, date, effective_date, source, pending, tags, treatment, refund_source, transfer_match_status, deleted_at, is_hidden_from_reports, split_role, accounts!transactions_account_id_fkey ( name, mask ), categories!transactions_category_id_fkey ( name, name_zh, icon, color )'
          )
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .eq('is_hidden_from_reports', false)
          .neq('split_role', 'parent')
          .order('effective_date', { ascending: false })
          .order('date', { ascending: false })
          .limit(6),
      ] as const

    const fullRequests = includeBudget
      ? ([getMonthlySummary(supabase, user.id, currentMonth)] as const)
      : ([] as const)

    const [
      accountsResult,
      monthTxResult,
      recentTxResult,
      budgetResult,
    ] = await Promise.allSettled([...baseRequests, ...fullRequests])

    const accounts =
      accountsResult.status === 'fulfilled' && !accountsResult.value.error
        ? accountsResult.value.data ?? []
        : []

    if (accountsResult.status === 'fulfilled' && accountsResult.value.error) {
      console.warn('Dashboard accounts query failed:', accountsResult.value.error)
    }

    const monthTx =
      monthTxResult.status === 'fulfilled' && !monthTxResult.value.error
        ? monthTxResult.value.data ?? []
        : []

    if (monthTxResult.status === 'fulfilled' && monthTxResult.value.error) {
      console.warn('Dashboard month transactions query failed:', monthTxResult.value.error)
    }

    let recentTx: unknown[] = []
    if (recentTxResult.status === 'fulfilled' && !recentTxResult.value.error) {
      recentTx = recentTxResult.value.data ?? []
    } else if (
      recentTxResult.status === 'fulfilled' &&
      isMissingColumnError(recentTxResult.value.error)
    ) {
      const fallbackRecent = await supabase
        .from('transactions')
        .select('id, merchant_name, description, amount, iso_currency_code, date, effective_date, source')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .eq('is_hidden_from_reports', false)
        .neq('split_role', 'parent')
        .order('effective_date', { ascending: false })
        .order('date', { ascending: false })
        .limit(6)
      recentTx = fallbackRecent.data ?? []
      if (fallbackRecent.error) {
        console.warn('Dashboard recent fallback query failed:', fallbackRecent.error)
      }
    } else if (recentTxResult.status === 'fulfilled' && recentTxResult.value.error) {
      console.warn('Dashboard recent query failed:', recentTxResult.value.error)
    }

    const budget = budgetResult?.status === 'fulfilled' ? budgetResult.value : null

    const dashboardMonthTx = monthTx as DashboardMonthTransaction[]
    const monthlyTotals = dashboardMonthTx.reduce(
      (totals, tx) => {
        if (normalizeCurrencyCode(tx.iso_currency_code) !== currencyCode) {
          return totals
        }
        const amounts = getMonthlySemanticAmounts(tx)
        totals.spending += amounts.spending
        totals.income += amounts.income
        return totals
      },
      { spending: 0, income: 0 }
    )
    const summary = {
      monthlySpending: monthlyTotals.spending,
      monthlyIncome: monthlyTotals.income,
      reviewCounts: getReviewCounts(dashboardMonthTx),
      largestDriver: getLargestSpendingDriver(dashboardMonthTx, currencyCode),
    }

    return Response.json({
      data: {
        currencyCode,
        currentMonth,
        accounts,
        recentTx: recentTx.map((tx) => ({
          ...(typeof tx === 'object' && tx !== null ? tx : {}),
          accounts:
            typeof tx === 'object' && tx !== null && 'accounts' in tx
              ? normalizeRelation(
                  (tx as { accounts?: unknown }).accounts as
                    | { name?: string | null; mask?: string | null }
                    | { name?: string | null; mask?: string | null }[]
                    | null
                    | undefined
                )
              : null,
          categories:
            typeof tx === 'object' && tx !== null && 'categories' in tx
              ? normalizeRelation(
                  (tx as { categories?: unknown }).categories as
                    | {
                        name?: string | null
                        name_zh?: string | null
                        icon?: string | null
                        color?: string | null
                      }
                    | {
                        name?: string | null
                        name_zh?: string | null
                        icon?: string | null
                        color?: string | null
                      }[]
                    | null
                    | undefined
                )
              : null,
        })),
        summary,
        budget,
        generatedAt: now.toISOString(),
      },
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return Response.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }
}
