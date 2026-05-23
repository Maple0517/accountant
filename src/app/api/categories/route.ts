import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const name = typeof body.name === 'string' ? body.name.trim() : ''

    if (!name) {
      return Response.json({ error: 'name is required' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('categories')
      .select('id')
      .eq('user_id', user.id)
      .ilike('name', name)
      .maybeSingle()

    if (existing) {
      return Response.json({ error: 'Category already exists' }, { status: 409 })
    }

    const { data: maxSort } = await supabase
      .from('categories')
      .select('sort_order')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextSortOrder = (maxSort?.sort_order ?? -1) + 1

    const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim() : '📦'
    const color = typeof body.color === 'string' && body.color.trim() ? body.color.trim() : '#607d8b'
    const type = ['income', 'expense', 'transfer'].includes(body.type) ? body.type : 'expense'
    const isExcludedFromBudget =
      typeof body.is_excluded_from_budget === 'boolean'
        ? body.is_excluded_from_budget
        : false

    const { data: newCategory, error } = await supabase
      .from('categories')
      .insert({
        user_id: user.id,
        name,
        icon,
        color,
        type,
        sort_order: nextSortOrder,
        is_excluded_from_budget: isExcludedFromBudget,
      })
      .select('id, user_id, name, name_zh, icon, color, type, is_excluded_from_budget, sort_order, created_at')
      .single()

    if (error) {
      console.error('Error creating category:', error)
      return Response.json({ error: 'Failed to create category' }, { status: 500 })
    }

    return Response.json(newCategory, { status: 201 })
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to create category'
    return Response.json({ error: errorMessage }, { status: 500 })
  }
}
