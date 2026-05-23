import { getCurrentUser } from '@/lib/auth/server'
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
    const period = parseAnalyticsPeriod(periodParam)

    const data = await getAnalyticsSummary(supabase, user.id, period)
    
    return Response.json({ data })
  } catch (error) {
    console.error('Analytics API error:', error)
    return Response.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}
