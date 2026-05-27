import { createClient } from '@/lib/supabase/server'
import { normalizeCurrencyCode } from '@/lib/money/currency'


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
  archived_at?: string | null
  archived_reason?: string | null
  plaid_items?: {
    institution_name?: string | null
    institution_id?: string | null
    last_synced_at?: string | null
    last_sync_error?: string | null
  } | null
}

type ProfileCurrency = {
  default_currency?: string | null
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [{ data: profile }, { data: accounts, error }] = await Promise.all([
      supabase
        .from('profiles')
        .select('default_currency')
        .eq('id', user.id)
        .maybeSingle<ProfileCurrency>(),
      supabase
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
        archived_at,
        archived_reason,
        plaid_items (
          institution_name,
          institution_id,
          last_synced_at,
          last_sync_error
        )
      `)
        .eq('user_id', user.id)
        .is('archived_at', null)
        .order('created_at', { ascending: false }),
    ])

    if (error) {
      console.error('Error fetching accounts:', error)
      return Response.json({ error: 'Failed to fetch accounts' }, { status: 500 })
    }

    const accountRows = (accounts || []) as AccountWithSyncMetadata[]
    const defaultCurrency = normalizeCurrencyCode(profile?.default_currency)
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

    return Response.json({ accounts: normalized, defaultCurrency })
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
