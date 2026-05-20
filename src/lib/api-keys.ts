import { createHash, randomBytes } from 'crypto'

export type ReceiptApiKey = {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at?: string | null
  revoked_at?: string | null
}

export function generateReceiptApiKey() {
  const token = `ak_${randomBytes(32).toString('base64url')}`

  return {
    token,
    keyPrefix: token.slice(0, 12),
    keyHash: hashApiKey(token),
  }
}

export function hashApiKey(apiKey: string) {
  return createHash('sha256').update(apiKey).digest('hex')
}
