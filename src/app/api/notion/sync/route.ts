import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { batchSyncToNotion, createTransactionDatabase } from '@/lib/notion/sync'

export const dynamic = 'force-dynamic'

/**
 * POST /api/notion/sync
 * Manually trigger Notion sync for the authenticated user.
 *
 * Body:
 * - full_sync?: boolean (if true, sync all transactions, not just unsynced)
 * - parent_page_id?: string (Notion page ID to create database in, for first-time setup)
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const fullSync = body.full_sync ?? false
    const parentPageId = body.parent_page_id

    const admin = createAdminClient()

    // Get user profile for Notion config. Use the server admin client so
    // Notion tokens do not need to be readable by browser clients.
    const { data: profile } = await admin
      .from('profiles')
      .select('notion_sync_enabled, notion_token, notion_database_id')
      .eq('id', user.id)
      .single()

    if (!profile?.notion_sync_enabled || !profile?.notion_token) {
      return Response.json(
        { error: 'Notion sync is not enabled. Configure it in Settings.' },
        { status: 400 }
      )
    }

    let databaseId = profile.notion_database_id

    // Create database if not exists
    if (!databaseId && parentPageId) {
      databaseId = await createTransactionDatabase(
        parentPageId,
        profile.notion_token
      )

      // Save database ID to profile
      await admin
        .from('profiles')
        .update({ notion_database_id: databaseId })
        .eq('id', user.id)
    }

    if (!databaseId) {
      return Response.json(
        {
          error:
            'No Notion database configured. Provide a parent_page_id to create one.',
        },
        { status: 400 }
      )
    }

    // Fetch transactions to sync
    let query = supabase
      .from('transactions')
      .select(
        `
        *,
        categories!transactions_category_id_fkey ( name ),
        accounts!transactions_account_id_fkey ( name )
      `
      )
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .eq('is_hidden_from_reports', false)
      .neq('split_role', 'parent')
      .order('effective_date', { ascending: false })
      .order('date', { ascending: false })

    if (!fullSync) {
      // Only sync transactions without a notion_page_id
      query = query.is('notion_page_id', null)
    }

    const { data: transactions, error: txError } = await query.limit(100)

    if (txError) {
      return Response.json(
        { error: 'Failed to fetch transactions' },
        { status: 500 }
      )
    }

    if (!transactions || transactions.length === 0) {
      return Response.json({
        success: true,
        message: 'No transactions to sync',
        synced: 0,
        failed: 0,
      })
    }

    // Map transactions with category and account names
    const mappedTransactions = transactions.map((tx) => ({
      ...tx,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      category_name: (tx.categories as any)?.name || undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      account_name: (tx.accounts as any)?.name || undefined,
    }))

    // Sync to Notion
    const result = await batchSyncToNotion(
      mappedTransactions,
      databaseId,
      profile.notion_token
    )

    if (result.results.length > 0) {
      for (const item of result.results) {
        await admin
          .from('transactions')
          .update({ notion_page_id: item.notionPageId })
          .eq('id', item.transactionId)
          .eq('user_id', user.id)
      }
    }

    return Response.json({
      success: true,
      synced: result.synced,
      failed: result.failed,
      total: transactions.length,
    })
  } catch (error) {
    console.error('Notion sync error:', error)
    return Response.json(
      { error: 'Notion sync failed', details: String(error) },
      { status: 500 }
    )
  }
}
