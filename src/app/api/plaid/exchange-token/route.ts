import { createClient } from '@/lib/supabase/server'
import { plaidClient } from '@/lib/plaid/client'

export const dynamic = 'force-dynamic'

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
    const tokenResponse = await plaidClient.itemPublicTokenExchange({
      public_token,
    })

    const access_token = tokenResponse.data.access_token
    const item_id = tokenResponse.data.item_id

    // Fetch item details to get institution info
    const itemResponse = await plaidClient.itemGet({ access_token })
    const institutionId = itemResponse.data.item.institution_id

    let institutionName = 'Unknown Institution'
    if (institutionId) {
      const instResponse = await plaidClient.institutionsGetById({
        institution_id: institutionId,
        country_codes: ['US' as any],
      })
      institutionName = instResponse.data.institution.name
    }

    // Save plaid item to Supabase
    const { data: plaidItem, error: itemError } = await supabase
      .from('plaid_items')
      .insert({
        user_id: user.id,
        access_token,
        item_id,
        institution_name: institutionName,
        institution_id: institutionId,
        status: 'active',
      })
      .select()
      .single()

    if (itemError || !plaidItem) {
      throw new Error(itemError?.message || 'Failed to save Plaid item')
    }

    // Fetch accounts
    const accountsResponse = await plaidClient.accountsGet({ access_token })
    
    // Map Plaid account types to our DB ENUM
    const mapPlaidType = (type: string, subtype: string | null) => {
      if (type === 'depository') {
        if (subtype === 'savings') return 'savings'
        return 'checking'
      }
      if (type === 'credit') return 'credit'
      if (type === 'investment') return 'investment'
      return 'other'
    }

    // Save accounts to Supabase
    const accountsData = accountsResponse.data.accounts.map(acc => ({
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

    const { error: accountsError } = await supabase
      .from('accounts')
      .insert(accountsData)

    if (accountsError) {
      console.error('Error saving accounts:', accountsError)
      // Continue even if saving accounts fails, item is already saved
    }

    return Response.json({ success: true, item_id: plaidItem.id })
  } catch (error: any) {
    console.error('Error exchanging token:', error)
    return Response.json(
      { error: error.message || 'Failed to exchange token' },
      { status: 500 }
    )
  }
}
