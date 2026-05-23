import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type NotionSettingsPayload = {
  display_name?: string | null
  default_currency?: string | null
  notion_sync_enabled?: boolean | null
  notion_token?: string | null
  notion_database_id?: string | null
}

async function getAuthenticatedUserId() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.id
}

function maskToken(value: string | null | undefined) {
  if (!value) return null
  if (value.length <= 8) return 'configured'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export async function GET() {
  try {
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, display_name, default_currency, notion_sync_enabled, notion_database_id, notion_token, created_at, updated_at'
      )
      .eq('id', userId)
      .single()

    if (error || !data) {
      return Response.json({ error: 'Failed to load settings' }, { status: 500 })
    }

    return Response.json({
      profile: {
        id: data.id,
        display_name: data.display_name,
        default_currency: data.default_currency,
        notion_sync_enabled: data.notion_sync_enabled,
        notion_database_id: data.notion_database_id,
        notion_token_configured: Boolean(data.notion_token),
        notion_token_masked: maskToken(data.notion_token),
        created_at: data.created_at,
        updated_at: data.updated_at,
      },
    })
  } catch (error) {
    console.error('Notion settings GET error:', error)
    return Response.json({ error: 'Failed to load settings' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as NotionSettingsPayload
    const update: Record<string, unknown> = {}

    if ('display_name' in body) {
      update.display_name =
        typeof body.display_name === 'string' ? body.display_name.trim() || null : null
    }

    if ('default_currency' in body) {
      if (body.default_currency !== 'USD' && body.default_currency !== 'CNY') {
        return Response.json({ error: 'Unsupported default_currency' }, { status: 400 })
      }
      update.default_currency = body.default_currency
    }

    if ('notion_sync_enabled' in body) {
      update.notion_sync_enabled = Boolean(body.notion_sync_enabled)
    }

    if ('notion_database_id' in body) {
      update.notion_database_id =
        typeof body.notion_database_id === 'string' && body.notion_database_id.trim()
          ? body.notion_database_id.trim()
          : null
    }

    if ('notion_token' in body) {
      update.notion_token =
        typeof body.notion_token === 'string' && body.notion_token.trim()
          ? body.notion_token.trim()
          : null
    }

    if (Object.keys(update).length === 0) {
      return Response.json({ error: 'No settings provided' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', userId)
      .select(
        'id, display_name, default_currency, notion_sync_enabled, notion_database_id, notion_token, created_at, updated_at'
      )
      .single()

    if (error || !data) {
      return Response.json({ error: 'Failed to save settings' }, { status: 500 })
    }

    return Response.json({
      profile: {
        id: data.id,
        display_name: data.display_name,
        default_currency: data.default_currency,
        notion_sync_enabled: data.notion_sync_enabled,
        notion_database_id: data.notion_database_id,
        notion_token_configured: Boolean(data.notion_token),
        notion_token_masked: maskToken(data.notion_token),
        created_at: data.created_at,
        updated_at: data.updated_at,
      },
    })
  } catch (error) {
    console.error('Notion settings PATCH error:', error)
    return Response.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
