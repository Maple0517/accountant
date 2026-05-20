import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMonthlySummary } from '@/modules/budget/budget.service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')

  if (!month) {
    return NextResponse.json({ error: 'month query parameter is required' }, { status: 400 })
  }

  try {
    const summary = await getMonthlySummary(supabase, user.id, month)
    return NextResponse.json(summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Invalid month format')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    console.error('[budget API]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
