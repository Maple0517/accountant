import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { updateCategoryBudget } from '@/modules/budget/budget.service'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { categoryId, month, amount } = body as Record<string, unknown>

  if (typeof categoryId !== 'string' || typeof month !== 'string' || typeof amount !== 'number') {
    return NextResponse.json(
      { error: 'categoryId must be a string, month must be a string, and amount must be a number' },
      { status: 400 },
    )
  }

  try {
    await updateCategoryBudget(supabase, user.id, categoryId, month, amount)
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('Amount must be') ||
      message.includes('Invalid month format') ||
      message.includes('categoryId is required')
    ) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    if (message.includes('Category not found for user')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    console.error('[budget API]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
