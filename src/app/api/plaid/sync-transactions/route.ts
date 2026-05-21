import { createClient } from '@/lib/supabase/server'
import {
  getSafePlaidSyncError,
  syncPlaidItemTransactions,
} from '@/lib/plaid/transactions-sync'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let plaidItemId: string | undefined
  let userId: string | undefined

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    userId = user.id
    const { plaid_item_id, backfill_uncategorized } = await request.json()
    plaidItemId = plaid_item_id

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

    return Response.json({
      ...result,
      message:
        'Synced transaction updates already available from Plaid. This does not force the bank to produce new pending transactions.',
    })
  } catch (error: unknown) {
    console.error('Error syncing transactions:', error)
    const errorMessage = getSafePlaidSyncError(error)

    if (plaidItemId && userId) {
      try {
        const supabase = await createClient()
        await supabase
          .from('plaid_items')
          .update({ last_sync_error: errorMessage })
          .eq('id', plaidItemId)
          .eq('user_id', userId)
      } catch (metadataError) {
        console.error('Error storing Plaid sync failure metadata:', metadataError)
      }
    }

    return Response.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
