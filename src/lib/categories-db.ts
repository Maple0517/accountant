import { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_CATEGORIES } from './categories'

export const REFUNDED_CATEGORY = {
  name: 'Refunded',
  name_zh: '已退款',
  icon: '↩️',
  color: '#14b8a6',
  type: 'expense' as const,
  is_excluded_from_budget: false,
}

export type CategoryRow = {
  id: string
  user_id: string
  name: string
  name_zh: string | null
  icon: string | null
  color: string | null
  type: 'income' | 'expense' | 'transfer'
  is_excluded_from_budget?: boolean | null
  sort_order?: number | null
  created_at?: string
}

function normalizeCategoryName(value: string) {
  return value.trim().toLocaleLowerCase('en-US')
}

function isUniqueCategoryNameError(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === '23505' ||
    Boolean(error?.message?.includes('categories_user_lower_name_uidx'))
  )
}

async function findCategoryByName(
  supabase: SupabaseClient,
  userId: string,
  name: string
): Promise<CategoryRow | null> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, user_id, name, name_zh, icon, color, type, is_excluded_from_budget, sort_order, created_at')
    .eq('user_id', userId)
    .ilike('name', name.trim())

  if (error) {
    console.error('Error finding category by name:', error)
    return null
  }

  return ((data || []).find(
    (c) => normalizeCategoryName(c.name) === normalizeCategoryName(name)
  ) as CategoryRow | undefined) ?? null
}

async function ensureExcludedCategory(
  supabase: SupabaseClient,
  userId: string,
  categories: CategoryRow[]
): Promise<CategoryRow[]> {
  const existing = categories.find(
    (category) =>
      category.is_excluded_from_budget === true ||
      normalizeCategoryName(category.name) === 'excluded' ||
      category.name_zh === '不计入'
  )

  if (existing) {
    if (!existing.is_excluded_from_budget) {
      const { data: updated, error } = await supabase
        .from('categories')
        .update({ is_excluded_from_budget: true })
        .eq('id', existing.id)
        .eq('user_id', userId)
        .select('id, user_id, name, name_zh, icon, color, type, is_excluded_from_budget, sort_order, created_at')
        .single()

      if (error) {
        console.error('Error marking excluded category:', error)
        return categories
      }

      return categories.map((category) =>
        category.id === updated.id ? (updated as CategoryRow) : category
      )
    }

    return categories
  }

  const maxSortOrder = categories.reduce(
    (max, category) => Math.max(max, Number(category.sort_order ?? 0)),
    0
  )

  const { data: inserted, error } = await supabase
    .from('categories')
    .insert({
      user_id: userId,
      name: 'Excluded',
      name_zh: '不计入',
      icon: '🚫',
      color: '#9e9e9e',
      type: 'expense',
      sort_order: maxSortOrder + 1,
      is_excluded_from_budget: true,
    })
    .select('id, user_id, name, name_zh, icon, color, type, is_excluded_from_budget, sort_order, created_at')
    .single()

  if (error) {
    if (isUniqueCategoryNameError(error)) {
      const recovered = await findCategoryByName(supabase, userId, 'Excluded')
      return recovered ? [...categories, recovered] : categories
    }

    console.error('Error ensuring excluded category:', error)
    return categories
  }

  return [...categories, inserted as CategoryRow]
}

/**
 * Fetch a user's categories. If they have none, seeds the defaults.
 */
export async function getUserCategories(
  supabase: SupabaseClient,
  userId: string
): Promise<CategoryRow[]> {
  const { data: categories, error } = await supabase
    .from('categories')
    .select('id, user_id, name, name_zh, icon, color, type, is_excluded_from_budget, sort_order, created_at')
    .eq('user_id', userId)

  if (error) {
    console.error('Error fetching categories:', error)
    return []
  }

  if (categories && categories.length > 0) {
    return ensureExcludedCategory(supabase, userId, categories as CategoryRow[])
  }

  // Seed default categories
  const categoriesToInsert = DEFAULT_CATEGORIES.map((c, index) => ({
    user_id: userId,
    name: c.name,
    name_zh: c.name_zh,
    icon: c.icon,
    color: c.color,
    type: c.type,
    is_excluded_from_budget: c.isExcludedFromBudget ?? false,
    sort_order: index,
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('categories')
    .insert(categoriesToInsert)
    .select('id, user_id, name, name_zh, icon, color, type, is_excluded_from_budget, sort_order, created_at')

  if (insertError) {
    console.error('Error seeding categories:', insertError)
    return []
  }

  return (inserted || []) as CategoryRow[]
}

/**
 * Gets an existing category by name (case-insensitive) or creates a new one.
 */
export async function getOrCreateCategory(
  supabase: SupabaseClient,
  userId: string,
  categoryInfo: {
    name: string
    name_zh?: string
    icon?: string
    type?: 'expense' | 'income' | 'transfer'
  },
  existingCategories?: CategoryRow[]
): Promise<CategoryRow | null> {
  const categories = existingCategories || (await getUserCategories(supabase, userId))
  
  const existing = categories.find(
    (c) => normalizeCategoryName(c.name) === normalizeCategoryName(categoryInfo.name) || 
           (c.name_zh && categoryInfo.name_zh && c.name_zh === categoryInfo.name_zh)
  )

  if (existing) {
    return existing
  }

  const exactConcurrentMatch = await findCategoryByName(
    supabase,
    userId,
    categoryInfo.name
  )

  if (exactConcurrentMatch) {
    if (existingCategories) {
      existingCategories.push(exactConcurrentMatch)
    }
    return exactConcurrentMatch
  }

  // Create new
  const { data: newCategory, error } = await supabase
    .from('categories')
    .insert({
      user_id: userId,
      name: categoryInfo.name.trim(),
      name_zh: categoryInfo.name_zh?.trim() || null,
      icon: categoryInfo.icon || '📦',
      color: '#607d8b', // default color
      type: categoryInfo.type || 'expense',
    })
    .select('*')
    .single()

  if (error) {
    if (!isUniqueCategoryNameError(error)) {
      console.error('Error creating new category:', error)
    }

    const recoveredMatch = await findCategoryByName(
      supabase,
      userId,
      categoryInfo.name
    )

    if (recoveredMatch) {
      if (existingCategories) {
        existingCategories.push(recoveredMatch)
      }
      return recoveredMatch
    }

    return null
  }

  if (existingCategories) {
    existingCategories.push(newCategory as CategoryRow)
  }

  return newCategory as CategoryRow
}

export async function getOrCreateRefundedCategory(
  supabase: SupabaseClient,
  userId: string,
  existingCategories?: CategoryRow[]
): Promise<CategoryRow | null> {
  const categories = existingCategories || (await getUserCategories(supabase, userId))
  const existing = categories.find(
    (category) =>
      normalizeCategoryName(category.name) === normalizeCategoryName(REFUNDED_CATEGORY.name) ||
      category.name_zh === REFUNDED_CATEGORY.name_zh
  )

  if (existing) {
    return existing
  }

  const maxSortOrder = categories.reduce(
    (max, category) => Math.max(max, Number(category.sort_order ?? 0)),
    0
  )

  const { data: inserted, error } = await supabase
    .from('categories')
    .insert({
      user_id: userId,
      name: REFUNDED_CATEGORY.name,
      name_zh: REFUNDED_CATEGORY.name_zh,
      icon: REFUNDED_CATEGORY.icon,
      color: REFUNDED_CATEGORY.color,
      type: REFUNDED_CATEGORY.type,
      sort_order: maxSortOrder + 1,
      is_excluded_from_budget: REFUNDED_CATEGORY.is_excluded_from_budget,
    })
    .select('*')
    .single()

  if (error) {
    if (!isUniqueCategoryNameError(error)) {
      console.error('Error ensuring refunded category:', error)
    }

    const recovered = await findCategoryByName(
      supabase,
      userId,
      REFUNDED_CATEGORY.name
    )

    if (recovered) {
      if (existingCategories) {
        existingCategories.push(recovered)
      }
      return recovered
    }

    return null
  }

  if (existingCategories) {
    existingCategories.push(inserted as CategoryRow)
  }

  return inserted as CategoryRow
}
