import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: accounts, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching accounts:', error)
      return Response.json({ error: 'Failed to fetch accounts' }, { status: 500 })
    }

    return Response.json({ accounts: accounts || [] })
  } catch (error: unknown) {
    console.error('Error in accounts API:', error)
    const errorMessage =
      error instanceof Error ? error.message : 'Internal server error'
    return Response.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
