import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getPlaidClient } from '@/lib/plaid/client'
import {
  disconnectPlaidItem,
  parsePlaidItemDisconnectMode,
  PlaidItemDisconnectError,
  type PlaidItemDisconnectMode,
  type PlaidItemDisconnectResult,
  type PlaidItemDisconnectClient,
} from '@/lib/plaid/item-disconnect'

export const dynamic = 'force-dynamic'

type PlaidItemRouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

type DeletePlaidItemRequestDeps = {
  getUserId: () => Promise<string | undefined>
  disconnect: (input: {
    userId: string
    plaidItemId: string
    mode: PlaidItemDisconnectMode
  }) => Promise<PlaidItemDisconnectResult>
}

export async function DELETE(request: Request, context: PlaidItemRouteContext) {
  const { id } = await context.params

  return handleDeletePlaidItemRequest(request, id, {
    getUserId: async () => {
      const supabase = await createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      return user?.id
    },
    disconnect: async ({ userId, plaidItemId, mode }) => {
      const admin = createAdminClient()
      return disconnectPlaidItem({
        supabase: admin as unknown as PlaidItemDisconnectClient,
        userId,
        plaidItemId,
        mode,
        removePlaidItem: async (accessToken) => {
          await getPlaidClient().itemRemove({ access_token: accessToken })
        },
      })
    },
  })
}

export async function handleDeletePlaidItemRequest(
  request: Request,
  plaidItemId: string | undefined,
  deps: DeletePlaidItemRequestDeps
) {
  try {
    const userId = await deps.getUserId()

    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!plaidItemId) {
      return Response.json({ error: 'Missing Plaid connection id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const mode = parsePlaidItemDisconnectMode(body)
    if (!mode) {
      return Response.json({ error: 'Invalid disconnect mode' }, { status: 400 })
    }

    const result = await deps.disconnect({ userId, plaidItemId, mode })

    return Response.json(result)
  } catch (error) {
    if (error instanceof PlaidItemDisconnectError) {
      return Response.json({ error: error.message }, { status: error.status })
    }

    console.error('Error disconnecting Plaid item:', error)
    return Response.json(
      { error: 'Failed to disconnect Plaid connection' },
      { status: 500 }
    )
  }
}
