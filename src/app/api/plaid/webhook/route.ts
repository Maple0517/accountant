import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncPlaidItemTransactions } from '@/lib/plaid/transactions-sync'

export const dynamic = 'force-dynamic'

type PlaidWebhookPayload = {
  webhook_type?: string
  webhook_code?: string
  item_id?: string
  error?: {
    error_code?: string
  } | null
}

const TRANSACTION_SYNC_CODES = new Set([
  'SYNC_UPDATES_AVAILABLE',
  'DEFAULT_UPDATE',
  'TRANSACTIONS_REMOVED',
])

function isWebhookSecretValid(request: Request) {
  const expectedSecret = process.env.PLAID_WEBHOOK_SECRET

  if (!expectedSecret) {
    return true
  }

  const url = new URL(request.url)
  return (
    request.headers.get('x-plaid-webhook-secret') === expectedSecret ||
    url.searchParams.get('secret') === expectedSecret
  )
}

export async function POST(request: Request) {
  if (!isWebhookSecretValid(request)) {
    return Response.json({ error: 'Unauthorized webhook' }, { status: 401 })
  }

  try {
    const payload = (await request.json()) as PlaidWebhookPayload
    const { webhook_type, webhook_code, item_id } = payload

    if (!item_id) {
      return Response.json({ received: true, ignored: true, reason: 'missing item_id' })
    }

    const supabase = createAdminClient()

    if (webhook_type === 'ITEM') {
      if (webhook_code === 'ERROR') {
        const errorCode = payload.error?.error_code || null
        await supabase
          .from('plaid_items')
          .update({
            status: errorCode === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'error',
            error_code: errorCode,
          })
          .eq('item_id', item_id)
      }

      if (webhook_code === 'LOGIN_REPAIRED') {
        await supabase
          .from('plaid_items')
          .update({ status: 'active', error_code: null })
          .eq('item_id', item_id)
      }

      return Response.json({ received: true })
    }

    if (
      webhook_type !== 'TRANSACTIONS' ||
      !webhook_code ||
      !TRANSACTION_SYNC_CODES.has(webhook_code)
    ) {
      return Response.json({ received: true, ignored: true })
    }

    const { data: item, error } = await supabase
      .from('plaid_items')
      .select('id')
      .eq('item_id', item_id)
      .single()

    if (error || !item) {
      return Response.json({
        received: true,
        ignored: true,
        reason: 'unknown item_id',
      })
    }

    after(async () => {
      try {
        const result = await syncPlaidItemTransactions({
          supabase,
          plaidItemId: item.id,
        })

        console.info('Plaid webhook transaction sync completed:', {
          item_id,
          webhook_code,
          result,
        })
      } catch (error) {
        console.error('Error syncing Plaid webhook transactions:', error)
      }
    })

    return Response.json({
      received: true,
      sync_scheduled: true,
      webhook_code,
    })
  } catch (error: unknown) {
    console.error('Error handling Plaid webhook:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to handle Plaid webhook'

    return Response.json({ error: errorMessage }, { status: 500 })
  }
}
