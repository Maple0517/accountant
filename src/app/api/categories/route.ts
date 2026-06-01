import { createClient } from '@/lib/supabase/server'
import { translateCategoryNameWithGemini } from '@/lib/gemini/category-translator'

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
    const rawName = typeof body.name === 'string' ? body.name.trim() : ''

    if (!rawName) {
      return Response.json({ error: 'name is required' }, { status: 400 })
    }

    let translatedName
    try {
      translatedName = await translateCategoryNameWithGemini(rawName)
    } catch (translationError) {
      console.error('Error translating category name:', translationError)
      return Response.json(
        { error: 'Failed to translate category name' },
        { status: 502 }
      )
    }

    const normalizeName = (value: string | null | undefined) =>
      value?.trim().toLocaleLowerCase('en-US') || ''
    const { data: existingCategories } = await supabase
      .from('categories')
      .select('id, name, name_zh')
      .eq('user_id', user.id)

    const translatedEnglishKey = normalizeName(translatedName.name)
    const translatedChineseKey = normalizeName(translatedName.name_zh)
    const existing = (existingCategories || []).find((category) => {
      const nameKey = normalizeName(category.name)
      const nameZhKey = normalizeName(category.name_zh)
      return (
        nameKey === translatedEnglishKey ||
        nameKey === translatedChineseKey ||
        nameZhKey === translatedEnglishKey ||
        nameZhKey === translatedChineseKey
      )
    })

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
    const isExcludedFromBudget =
      typeof body.is_excluded_from_budget === 'boolean'
        ? body.is_excluded_from_budget
        : false

    const { data: newCategory, error } = await supabase
      .from('categories')
      .insert({
        user_id: user.id,
        name: translatedName.name,
        name_zh: translatedName.name_zh,
        icon,
        color,
        type: 'expense',
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
