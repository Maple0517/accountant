import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPlaidClient } from '@/lib/plaid/client'
import { isPlaidItemNotFoundError } from '@/lib/plaid/item-disconnect'
import { CountryCode, Products, type LinkTokenCreateRequest } from 'plaid'

export const dynamic = 'force-dynamic'
type LinkTokenMode = 'create' | 'update_accounts'

export function parseLinkTokenRequestBody(body: unknown): {
  mode: LinkTokenMode
  plaidItemId: string | null
} | null {
  if (!body || typeof body !== 'object') {
    return { mode: 'create', plaidItemId: null }
  }

  const rawMode = (body as { mode?: unknown }).mode
  const mode = rawMode === undefined ? 'create' : rawMode
  if (mode !== 'create' && mode !== 'update_accounts') {
    return null
  }

  const plaidItemId = (body as { plaid_item_id?: unknown }).plaid_item_id
  return {
    mode,
    plaidItemId: typeof plaidItemId === 'string' && plaidItemId ? plaidItemId : null,
  }
}

export function buildPlaidLinkTokenConfig({
  userId,
  accessToken,
}: {
  userId: string
  accessToken?: string
}): LinkTokenCreateRequest {
  const configs: LinkTokenCreateRequest = {
    user: {
      client_user_id: userId,
    },
    client_name: 'Accountant App',
    country_codes: [CountryCode.Us],
    language: 'en',
  }

  if (accessToken) {
    return {
      ...configs,
      access_token: accessToken,
      update: { account_selection_enabled: true },
    }
  }

  return {
    ...configs,
    products: [Products.Transactions],
    ...(process.env.PLAID_WEBHOOK_URL
      ? { webhook: process.env.PLAID_WEBHOOK_URL }
      : {}),
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseLinkTokenRequestBody(body)
    if (!parsed) {
      return Response.json({ error: 'Invalid link token mode' }, { status: 400 })
    }

    let accessToken: string | undefined
    if (parsed.mode === 'update_accounts') {
      if (!parsed.plaidItemId) {
        return Response.json({ error: 'Missing plaid_item_id' }, { status: 400 })
      }

      const admin = createAdminClient()
      const { data: item, error: itemError } = await admin
        .from('plaid_items')
        .select('access_token')
        .eq('id', parsed.plaidItemId)
        .eq('user_id', user.id)
        .single()

      if (itemError || !item) {
        return Response.json({ error: 'Plaid connection not found' }, { status: 404 })
      }

      accessToken = item.access_token
    }

    const configs = buildPlaidLinkTokenConfig({ userId: user.id, accessToken })
    const createTokenResponse = await getPlaidClient().linkTokenCreate(configs)

    return Response.json({ link_token: createTokenResponse.data.link_token })
  } catch (error: unknown) {
    if (isPlaidItemNotFoundError(error)) {
      return Response.json(
        { error: 'Plaid connection is no longer available. Disconnect and reconnect this bank.' },
        { status: 409 }
      )
    }

    console.error('Error creating link token:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create link token'

    return Response.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
