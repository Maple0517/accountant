import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { generateReceiptApiKey, type ReceiptApiKey } from '@/lib/api-keys'

export const dynamic = 'force-dynamic'

async function getAuthenticatedUserId() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.id
}

export async function GET() {
  try {
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('api_keys')
      .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      return Response.json({
        api_keys: [],
        migration_required: true,
        error: isMissingApiKeysTableError(error)
          ? undefined
          : 'API key storage is not ready.',
      })
    }

    return Response.json({ api_keys: (data || []) as ReceiptApiKey[] })
  } catch (error) {
    console.error('API keys GET error:', error)
    return Response.json({ error: 'Failed to fetch API keys' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, 80)
        : 'iOS Shortcut'
    const { token, keyPrefix, keyHash } = generateReceiptApiKey()

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('api_keys')
      .insert({
        user_id: userId,
        name,
        key_prefix: keyPrefix,
        key_hash: keyHash,
      })
      .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
      .single()

    if (error) {
      if (isMissingApiKeysTableError(error)) {
        return Response.json(
          {
            error:
              'API key storage is not ready. Run supabase/migrations/002_ios_receipt_api_keys.sql first.',
          },
          { status: 500 }
        )
      }

      console.error('Failed to create API key:', error)
      return Response.json({ error: 'Failed to create API key' }, { status: 500 })
    }

    return Response.json({ api_key: data as ReceiptApiKey, token })
  } catch (error) {
    console.error('API keys POST error:', error)
    return Response.json({ error: 'Failed to create API key' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    if (typeof body.id !== 'string' || !body.id) {
      return Response.json({ error: 'Missing API key id' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', body.id)
      .eq('user_id', userId)
      .is('revoked_at', null)

    if (error) {
      if (isMissingApiKeysTableError(error)) {
        return Response.json(
          {
            error:
              'API key storage is not ready. Run supabase/migrations/002_ios_receipt_api_keys.sql first.',
          },
          { status: 500 }
        )
      }

      console.error('Failed to revoke API key:', error)
      return Response.json({ error: 'Failed to revoke API key' }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error('API keys DELETE error:', error)
    return Response.json({ error: 'Failed to revoke API key' }, { status: 500 })
  }
}

function isMissingApiKeysTableError(error: { code?: string; message?: string }) {
  return (
    error.code === 'PGRST205' ||
    Boolean(error.message?.includes("Could not find the table 'public.api_keys'"))
  )
}
