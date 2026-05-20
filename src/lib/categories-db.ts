import { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_CATEGORIES } from './categories'

export type CategoryRow = {
  id: string
  user_id: string
  name: string
  name_zh: string | null
  icon: string | null
  color: string | null
  type: 'income' | 'expense' | 'transfer'
}

function normalizeCategoryName(value: string) {
  return value.trim().toLocaleLowerCase('en-US')
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
    .select('*')
    .eq('user_id', userId)

  if (error) {
    console.error('Error fetching categories:', error)
    return []
  }

  // If user has categories, return them
  if (categories && categories.length > 0) {
    return categories as CategoryRow[]
  }

  // Seed default categories
  const categoriesToInsert = DEFAULT_CATEGORIES.map((c, index) => ({
    user_id: userId,
    name: c.name,
    name_zh: c.name_zh,
    icon: c.icon,
    color: c.color,
    type: c.type,
    sort_order: index,
  }))

  const { data: inserted, error: insertError } = await supabase
    .from('categories')
    .insert(categoriesToInsert)
    .select('*')

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

  const { data: concurrentMatch, error: concurrentMatchError } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .ilike('name', categoryInfo.name.trim())

  if (concurrentMatchError) {
    console.error('Error checking for concurrent category creation:', concurrentMatchError)
  }

  const exactConcurrentMatch = (concurrentMatch || []).find(
    (c) => normalizeCategoryName(c.name) === normalizeCategoryName(categoryInfo.name)
  ) as CategoryRow | undefined

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
    console.error('Error creating new category:', error)

    const { data: retryMatch } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .ilike('name', categoryInfo.name.trim())

    const recoveredMatch = (retryMatch || []).find(
      (c) => normalizeCategoryName(c.name) === normalizeCategoryName(categoryInfo.name)
    ) as CategoryRow | undefined

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
