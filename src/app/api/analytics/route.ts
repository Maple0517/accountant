import { getCurrentUser } from '@/lib/auth/server'
import { normalizeCurrencyCode } from '@/lib/money/currency'
import { getMonthlySummary } from '@/modules/budget/budget.service'
import { getAnalyticsSummary, parseAnalyticsPeriod } from '@/modules/analytics/analytics.service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getCurrentUser()
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const periodParam = searchParams.get('period')
    const requestedCurrency = searchParams.get('currency')
    const period = parseAnalyticsPeriod(periodParam)
    const { data: profile } = await supabase
      .from('profiles')
      .select('default_currency')
      .eq('id', user.id)
      .maybeSingle()
    const defaultCurrency =
      typeof profile?.default_currency === 'string' && profile.default_currency
        ? profile.default_currency
        : 'USD'
    const currencyCode = normalizeCurrencyCode(requestedCurrency || defaultCurrency)

    const now = new Date()
    const budgetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const budgetSummary =
      period === 'month'
        ? await getMonthlySummary(supabase, user.id, budgetMonth).catch((error) => {
            console.warn('Analytics budget impact unavailable:', error)
            return null
          })
        : null

    const data = await getAnalyticsSummary(supabase, user.id, period, currencyCode, {
      now,
      budgetSummary,
    })

    return Response.json({ data })
  } catch (error) {
    console.error('Analytics API error:', error)
    return Response.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}
