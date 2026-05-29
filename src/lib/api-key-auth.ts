import { createAdminClient } from '@/lib/supabase/admin'
import { hashApiKey } from '@/lib/api-keys'

export type ApiKeyAuthResult = {
  userId: string
  apiKeyId: string
}

export function extractBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization')
  if (!authorization) return undefined

  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || undefined
}

export async function authenticateWithApiKey(
  apiKey: string
): Promise<ApiKeyAuthResult | undefined> {
  try {
    const normalizedApiKey = apiKey.trim()
    if (!normalizedApiKey) return undefined

    const supabase = createAdminClient()
    const keyHash = hashApiKey(normalizedApiKey)

    const { data } = await supabase
      .from('api_keys')
      .select('id, user_id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .maybeSingle()

    if (!data?.user_id || !data.id) return undefined

    return { userId: data.user_id, apiKeyId: data.id }
  } catch {
    return undefined
  }
}

export async function markApiKeyUsed(apiKeyId: string | undefined): Promise<void> {
  if (!apiKeyId) return

  try {
    const supabase = createAdminClient()
    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', apiKeyId)
  } catch (error) {
    console.error('Failed to update API key usage timestamp:', error)
  }
}
