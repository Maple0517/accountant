import { createClient } from '@/lib/supabase/server'
import { plaidClient } from '@/lib/plaid/client'
import { CountryCode, Products } from 'plaid'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const configs = {
      user: {
        client_user_id: user.id,
      },
      client_name: 'Accountant App',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    }

    const createTokenResponse = await plaidClient.linkTokenCreate(configs)

    return Response.json({ link_token: createTokenResponse.data.link_token })
  } catch (error: any) {
    console.error('Error creating link token:', error)
    return Response.json(
      { error: error.message || 'Failed to create link token' },
      { status: 500 }
    )
  }
}
