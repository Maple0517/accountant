import { createClient } from '@/lib/supabase/server'
import { syncPlaidItemTransactions } from '@/lib/plaid/transactions-sync'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { plaid_item_id, backfill_uncategorized } = await request.json()

    if (!plaid_item_id) {
      return Response.json({ error: 'Missing plaid_item_id' }, { status: 400 })
    }

    const result = await syncPlaidItemTransactions({
      supabase,
      plaidItemId: plaid_item_id,
      userId: user.id,
      backfillUncategorized: backfill_uncategorized,
      ensureWebhook: true,
    })

    return Response.json(result)
  } catch (error: unknown) {
    console.error('Error syncing transactions:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to sync transactions'

    return Response.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
