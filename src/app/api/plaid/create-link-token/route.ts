import { createClient } from '@/lib/supabase/server'
import { getPlaidClient } from '@/lib/plaid/client'
import { CountryCode, Products } from 'plaid'

export const dynamic = 'force-dynamic'

export async function POST() {
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
      ...(process.env.PLAID_WEBHOOK_URL
        ? { webhook: process.env.PLAID_WEBHOOK_URL }
        : {}),
    }

    const createTokenResponse = await getPlaidClient().linkTokenCreate(configs)

    return Response.json({ link_token: createTokenResponse.data.link_token })
  } catch (error: unknown) {
    console.error('Error creating link token:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create link token'

    return Response.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
