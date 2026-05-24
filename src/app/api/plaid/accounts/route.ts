import { createClient } from '@/lib/supabase/server'


export const dynamic = 'force-dynamic'

type AccountWithSyncMetadata = {
  id: string
  user_id: string
  plaid_item_id?: string | null
  plaid_account_id?: string | null
  name: string
  official_name?: string | null
  type: string
  subtype?: string | null
  mask?: string | null
  current_balance?: number | null
  available_balance?: number | null
  iso_currency_code?: string | null
  is_manual: boolean
  created_at: string
  updated_at: string
  last_synced_at?: string | null
  last_sync_error?: string | null
  institution_name?: string | null
  institution_id?: string | null
  connection_account_count?: number
  plaid_items?: {
    institution_name?: string | null
    institution_id?: string | null
    last_synced_at?: string | null
    last_sync_error?: string | null
  } | null
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: accounts, error } = await supabase
      .from('accounts')
      .select(`
        id,
        user_id,
        plaid_item_id,
        plaid_account_id,
        name,
        official_name,
        type,
        subtype,
        mask,
        current_balance,
        available_balance,
        iso_currency_code,
        is_manual,
        created_at,
        updated_at,
        plaid_items (
          institution_name,
          institution_id,
          last_synced_at,
          last_sync_error
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching accounts:', error)
      return Response.json({ error: 'Failed to fetch accounts' }, { status: 500 })
    }

    const accountRows = (accounts || []) as AccountWithSyncMetadata[]
    const connectionCounts = accountRows.reduce<Record<string, number>>((counts, account) => {
      if (account.plaid_item_id) {
        counts[account.plaid_item_id] = (counts[account.plaid_item_id] || 0) + 1
      }

      return counts
    }, {})

    const normalized = accountRows.map((account) => {
      const plaidItem = Array.isArray(account.plaid_items)
        ? account.plaid_items[0]
        : account.plaid_items

      return {
        ...account,
        plaid_items: plaidItem
          ? {
              institution_name: plaidItem.institution_name ?? null,
              institution_id: plaidItem.institution_id ?? null,
            }
          : null,
        last_synced_at: plaidItem?.last_synced_at ?? null,
        last_sync_error: plaidItem?.last_sync_error ?? null,
        institution_name: plaidItem?.institution_name ?? null,
        institution_id: plaidItem?.institution_id ?? null,
        connection_account_count: account.plaid_item_id
          ? connectionCounts[account.plaid_item_id] || 1
          : 0,
      }
    })

    return Response.json({ accounts: normalized })
  } catch (error: unknown) {
    console.error('Error in accounts API:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Internal server error'
    return Response.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
