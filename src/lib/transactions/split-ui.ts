import type { Category, TransactionTreatment } from '@/types'

type SplitTreatmentPatchInput = {
  treatment: TransactionTreatment
}

function normalizeCategoryName(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

export function findExcludedCategoryId(categories: Array<Pick<Category, 'id' | 'name' | 'name_zh' | 'is_excluded_from_budget'>>) {
  const excluded = categories.find((category) => category.is_excluded_from_budget === true)
  if (excluded) return excluded.id

  const namedExcluded = categories.find((category) => {
    const name = normalizeCategoryName(category.name)
    const nameZh = normalizeCategoryName(category.name_zh)
    return name === 'excluded' || nameZh === '不计入'
  })

  return namedExcluded?.id ?? null
}

export function getCategoryPatchForSplitTreatment(
  preset: SplitTreatmentPatchInput,
  categories: Array<Pick<Category, 'id' | 'name' | 'name_zh' | 'is_excluded_from_budget'>>
) {
  if (preset.treatment !== 'excluded') return {}

  const excludedCategoryId = findExcludedCategoryId(categories)
  return excludedCategoryId ? { category_id: excludedCategoryId } : {}
}
