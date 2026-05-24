import { getCurrentUser } from '@/lib/auth/server'
import { normalizeCurrencyCode } from '@/lib/money/currency'
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

    const data = await getAnalyticsSummary(supabase, user.id, period, currencyCode)
    
    return Response.json({ data })
  } catch (error) {
    console.error('Analytics API error:', error)
    return Response.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}
