import { getCurrentUser } from '@/lib/auth/server'
import { getMonthlySummary } from '@/modules/budget/budget.service'
import { getAnalyticsSummary } from '@/modules/analytics/analytics.service'

export const dynamic = 'force-dynamic'

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

export async function GET() {
  try {
    const { supabase, user } = await getCurrentUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()
    const firstDayOfMonth = toMonthStart(now)
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const firstDayOfNextMonth = toMonthStart(nextMonthDate)
    const currentMonth = toMonthParam(now)

    const [accountsResult, monthTxResult, recentTxResult, analyticsResult, budgetResult] =
      await Promise.allSettled([
        supabase
          .from('accounts')
          .select('type, current_balance, available_balance')
          .eq('user_id', user.id),
        supabase
          .from('transactions')
          .select(
            'id, amount, pending, category_id, tags, transaction_kind, budget_behavior, budget_effective_date, date, transfer_match_status'
          )
          .eq('user_id', user.id)
          .or(
            `and(budget_effective_date.gte.${firstDayOfMonth},budget_effective_date.lt.${firstDayOfNextMonth}),and(budget_effective_date.is.null,date.gte.${firstDayOfMonth},date.lt.${firstDayOfNextMonth})`
          ),
        supabase
          .from('transactions')
          .select(
            'id, merchant_name, description, amount, date, source, pending, tags, transaction_kind, budget_behavior, transfer_match_status, accounts!transactions_account_id_fkey ( name, mask ), categories!transactions_category_id_fkey ( name, name_zh, icon, color )'
          )
          .eq('user_id', user.id)
          .order('date', { ascending: false })
          .limit(6),
        getAnalyticsSummary(supabase, user.id, 'month'),
        getMonthlySummary(supabase, user.id, currentMonth),
      ])

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
        .select('id, merchant_name, description, amount, date, source')
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .limit(6)
      recentTx = fallbackRecent.data ?? []
      if (fallbackRecent.error) {
        console.warn('Dashboard recent fallback query failed:', fallbackRecent.error)
      }
    } else if (recentTxResult.status === 'fulfilled' && recentTxResult.value.error) {
      console.warn('Dashboard recent query failed:', recentTxResult.value.error)
    }

    const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : null
    const budget = budgetResult.status === 'fulfilled' ? budgetResult.value : null

    return Response.json({
      data: {
        accounts,
        monthTx,
        recentTx,
        analytics,
        budget,
        generatedAt: now.toISOString(),
      },
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return Response.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }
}
