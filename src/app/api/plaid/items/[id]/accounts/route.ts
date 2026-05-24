import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getPlaidClient } from '@/lib/plaid/client'
import {
  PlaidAccountSelectionError,
  parseSelectedPlaidAccountIds,
  reconcilePlaidItemAccounts,
  type PlaidAccountSelectionClient,
} from '@/lib/plaid/account-selection'

export const dynamic = 'force-dynamic'

type PlaidItemAccountsRouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

export async function PATCH(request: Request, context: PlaidItemAccountsRouteContext) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params
    if (!id) {
      return Response.json({ error: 'Missing Plaid connection id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const selectedPlaidAccountIds = parseSelectedPlaidAccountIds(body)
    if (!selectedPlaidAccountIds) {
      return Response.json(
        { error: 'Missing selected Plaid account ids' },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    const result = await reconcilePlaidItemAccounts({
      supabase: admin as unknown as PlaidAccountSelectionClient,
      userId: user.id,
      plaidItemId: id,
      selectedPlaidAccountIds,
      getPlaidAccounts: async (accessToken) => {
        const response = await getPlaidClient().accountsGet({ access_token: accessToken })
        return response.data.accounts
      },
    })

    return Response.json(result)
  } catch (error) {
    if (error instanceof PlaidAccountSelectionError) {
      return Response.json({ error: error.message }, { status: error.status })
    }

    console.error('Error reconciling Plaid account selection:', error)
    return Response.json(
      { error: 'Failed to update shared Plaid accounts' },
      { status: 500 }
    )
  }
}
