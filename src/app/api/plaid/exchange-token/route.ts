import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPlaidClient } from '@/lib/plaid/client'
import { CountryCode } from 'plaid'

export const dynamic = 'force-dynamic'

export function mapPlaidType(type: string, subtype: string | null) {
  if (type === 'depository') {
    if (subtype === 'savings') return 'savings'
    return 'checking'
  }
  if (type === 'credit') return 'credit'
  if (type === 'investment') return 'investment'
  return 'other'
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { public_token } = await request.json()

    if (!public_token) {
      return Response.json({ error: 'Missing public_token' }, { status: 400 })
    }

    // Exchange public token for access token
    const tokenResponse = await getPlaidClient().itemPublicTokenExchange({
      public_token,
    })

    const access_token = tokenResponse.data.access_token
    const item_id = tokenResponse.data.item_id

    // Fetch item details to get institution info
    const itemResponse = await getPlaidClient().itemGet({ access_token })
    const institutionId = itemResponse.data.item.institution_id

    let institutionName = 'Unknown Institution'
    if (institutionId) {
      const instResponse = await getPlaidClient().institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      })
      institutionName = instResponse.data.institution.name
    }

    const admin = createAdminClient()

    // Save Plaid item with the service role so the sensitive access token never
    // needs direct browser/Data API permissions.
    const { data: plaidItem, error: itemError } = await admin
      .from('plaid_items')
      .upsert({
        user_id: user.id,
        access_token,
        item_id,
        institution_name: institutionName,
        institution_id: institutionId,
        status: 'active',
      }, {
        onConflict: 'item_id',
        ignoreDuplicates: false,
      })
      .select()
      .single()

    if (itemError || !plaidItem) {
      throw new Error(itemError?.message || 'Failed to save Plaid item')
    }

    // Fetch accounts
    const accountsResponse = await getPlaidClient().accountsGet({ access_token })
    
    const existingAccountsByPlaidId = new Map(
      (
        (
          await admin
            .from('accounts')
            .select('id, plaid_account_id')
            .eq('user_id', user.id)
            .eq('plaid_item_id', plaidItem.id)
        ).data || []
      ).map((account) => [account.plaid_account_id, account.id])
    )

    const accountsData = accountsResponse.data.accounts.map((acc) => ({
      user_id: user.id,
      plaid_item_id: plaidItem.id,
      plaid_account_id: acc.account_id,
      name: acc.name,
      official_name: acc.official_name || null,
      type: mapPlaidType(acc.type, acc.subtype || null),
      subtype: acc.subtype || null,
      mask: acc.mask || null,
      current_balance: acc.balances.current,
      available_balance: acc.balances.available || null,
      iso_currency_code: acc.balances.iso_currency_code || 'USD',
      is_manual: false,
    }))

    const accountsToInsert = accountsData.filter(
      (acc) => !existingAccountsByPlaidId.has(acc.plaid_account_id)
    )

    const { error: accountsError } = accountsToInsert.length
      ? await admin.from('accounts').insert(accountsToInsert)
      : { error: null }

    if (accountsError) {
      console.error('Error saving accounts:', accountsError)
      // Continue even if saving accounts fails, item is already saved
    }

    return Response.json({ success: true, item_id: plaidItem.id })
  } catch (error: unknown) {
    console.error('Error exchanging token:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to exchange token'
    return Response.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
