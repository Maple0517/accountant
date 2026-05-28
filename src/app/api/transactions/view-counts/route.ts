import { createClient } from '@/lib/supabase/server'
import {
  applyBaseFilters,
  loadSavedViewCounts,
  countAllPendingAiClassifications,
} from '@/lib/transactions/list-filters'

export const dynamic = 'force-dynamic'

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
    const filterContext: Parameters<typeof applyBaseFilters>[1] = {
      userId: user.id,
      search: searchParams.get('search')?.trim() || '',
      sourceOrAccount: searchParams.get('sourceOrAccount') || 'all',
      category: searchParams.get('category') || 'all',
      currency: searchParams.get('currency') || 'all',
      dateFrom: searchParams.get('dateFrom') || '',
      dateTo: searchParams.get('dateTo') || '',
      showHidden: searchParams.get('showHidden') === 'true',
      showDeleted: searchParams.get('showDeleted') === 'true',
      showSplitParents: searchParams.get('showSplitParents') === 'true',
      splitGroupId: searchParams.get('splitGroupId') || '',
    }

    const [viewCounts, allAiPendingCount] = await Promise.all([
      loadSavedViewCounts(supabase as never, filterContext),
      countAllPendingAiClassifications(supabase as never, user.id),
    ])

    return Response.json({ viewCounts, allAiPendingCount })
  } catch (error: unknown) {
    console.error('Error in transaction view counts API:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to fetch transaction view counts'
    return Response.json({ error: errorMessage }, { status: 500 })
  }
}
