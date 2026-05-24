import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateCategory } from '@/lib/categories-db'
import {
  updateTransactionSemantics,
  type TransactionSemanticsClient,
} from '@/lib/transactions/semantic-update'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authClient = await createClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()

    const { id } = await context.params
    const body = await request.json()

    const result = await updateTransactionSemantics({
      supabase: supabase as unknown as TransactionSemanticsClient,
      userId: user.id,
      transactionId: id,
      body,
      ensureCategory: (client, targetUserId, categoryInfo) =>
        getOrCreateCategory(client as never, targetUserId, categoryInfo),
    })

    if (!result.ok) {
      return Response.json(
        { error: result.error },
        { status: result.status }
      )
    }

    return Response.json({ success: true, transaction: result.transaction })
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to update transaction semantics'

    return Response.json({ error: errorMessage }, { status: 500 })
  }
}
