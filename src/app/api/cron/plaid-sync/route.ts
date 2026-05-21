import { createAdminClient } from '@/lib/supabase/admin'
import {
  getSafePlaidSyncError,
  syncPlaidItemTransactions,
} from '@/lib/plaid/transactions-sync'

export const dynamic = 'force-dynamic'

type PlaidItemForCron = {
  id: string
  user_id: string
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET

  if (!expected || authHeader !== `Bearer ${expected}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data: items, error } = await supabase
    .from('plaid_items')
    .select('id, user_id')
    .eq('status', 'active')

  if (error) {
    console.error('Error loading Plaid items for cron sync:', error)
    return Response.json(
      { error: 'Failed to load Plaid items for sync' },
      { status: 500 }
    )
  }

  const results = []

  for (const item of (items || []) as PlaidItemForCron[]) {
    try {
      const result = await syncPlaidItemTransactions({
        supabase,
        plaidItemId: item.id,
        userId: item.user_id,
      })

      results.push({
        plaid_item_id: item.id,
        success: true,
        result,
      })
    } catch (error) {
      console.error('Error syncing Plaid item from cron:', {
        plaid_item_id: item.id,
        error,
      })

      const errorMessage = getSafePlaidSyncError(error)

      await supabase
        .from('plaid_items')
        .update({ last_sync_error: errorMessage })
        .eq('id', item.id)
        .eq('user_id', item.user_id)

      results.push({
        plaid_item_id: item.id,
        success: false,
        error: errorMessage,
      })
    }
  }

  return Response.json({
    success: true,
    checked_items: results.length,
    results,
  })
}
