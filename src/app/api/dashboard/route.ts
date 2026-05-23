import { getCurrentUser } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

function toMonthStart(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
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

    const [{ data: accounts }, { data: monthTx }, { data: recentTx }] =
      await Promise.all([
        supabase
          .from('accounts')
          .select('type, current_balance')
          .eq('user_id', user.id),
        supabase
          .from('transactions')
          .select('amount, budget_behavior, budget_effective_date, date')
          .eq('user_id', user.id)
          .eq('pending', false)
          .or(`and(budget_effective_date.gte.${firstDayOfMonth},budget_effective_date.lt.${firstDayOfNextMonth}),and(budget_effective_date.is.null,date.gte.${firstDayOfMonth},date.lt.${firstDayOfNextMonth})`),
        supabase
          .from('transactions')
          .select('id, merchant_name, description, amount, date, source')
          .eq('user_id', user.id)
          .order('date', { ascending: false })
          .limit(5),
      ])

    return Response.json({
      data: {
        accounts,
        monthTx,
        recentTx
      }
    })
  } catch (error) {
    console.error('Dashboard API error:', error)
    return Response.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }
}
