import { getCurrentUser } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { user } = await getCurrentUser()
  return Response.json({ email: user?.email ?? null })
}
