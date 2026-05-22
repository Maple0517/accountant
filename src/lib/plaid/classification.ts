export type ExistingTransactionSnapshot = {
  category_id: string | null
  merchant_name: string | null
  tags?: string[] | null
}

export type PlaidCategorySource = {
  personal_finance_category?: {
    primary?: string | null
    detailed?: string | null
  } | null
  category?: string[] | null
}

export const AI_CLASSIFIED_TAG = 'classification:ai'
export const PLAID_FALLBACK_TAG = 'classification:plaid-fallback'
export const AI_PENDING_TAG = 'classification:ai-pending'

type ClassificationSource = 'ai' | 'plaid-fallback' | 'existing' | 'none'

export function shouldRefreshAiClassification(
  transaction: Pick<ExistingTransactionSnapshot, 'category_id' | 'tags'>
) {
  const tags = transaction.tags || []
  return (
    !transaction.category_id ||
    tags.includes(AI_PENDING_TAG) ||
    tags.includes(PLAID_FALLBACK_TAG)
  )
}

function canReplaceExistingCategory(
  existingTransaction: ExistingTransactionSnapshot | undefined
) {
  if (!existingTransaction?.category_id) return true

  return shouldRefreshAiClassification(existingTransaction)
}

export function mergeClassificationTags(
  existingTags: string[] | null | undefined,
  source: ClassificationSource
) {
  const tags = new Set(existingTags || [])

  tags.delete(AI_CLASSIFIED_TAG)
  tags.delete(PLAID_FALLBACK_TAG)
  tags.delete(AI_PENDING_TAG)

  if (source === 'ai') {
    tags.add(AI_CLASSIFIED_TAG)
  }

  if (source === 'plaid-fallback') {
    tags.add(PLAID_FALLBACK_TAG)
    tags.add(AI_PENDING_TAG)
  }

  if (source === 'none') {
    tags.add(AI_PENDING_TAG)
  }

  return Array.from(tags)
}

export function mergeTransactionClassification(
  existingTransaction: ExistingTransactionSnapshot | undefined,
  plaidTransaction: {
    merchant_name?: string | null
    name: string
  },
  classification?: {
    clean_merchant_name: string
    category?: {
      id: string
    }
  },
  plaidFallback?: {
    category: {
      id: string
    }
  }
) {
  const useAiCategory =
    Boolean(classification?.category?.id) &&
    canReplaceExistingCategory(existingTransaction)
  const categoryId =
    (useAiCategory ? classification?.category?.id : undefined) ??
    existingTransaction?.category_id ??
    plaidFallback?.category.id ??
    null
  const source: ClassificationSource = useAiCategory
    ? 'ai'
    : existingTransaction?.category_id
      ? 'existing'
      : plaidFallback?.category.id
        ? 'plaid-fallback'
        : 'none'

  return {
    categoryId,
    cleanName:
      classification?.clean_merchant_name ||
      existingTransaction?.merchant_name ||
      plaidTransaction.merchant_name ||
      plaidTransaction.name,
    tags: mergeClassificationTags(existingTransaction?.tags, source),
  }
}

export function getPlaidPrimaryCategory(tx: PlaidCategorySource) {
  return tx.personal_finance_category?.primary || tx.category?.[0] || null
}

/**
 * Removes internal classification system tags from a tag array.
 * Call this when a user manually sets a category so AI cannot overwrite it again.
 */
export function stripAutomaticClassificationTags(
  tags: string[] | null | undefined
): string[] {
  return (Array.isArray(tags) ? tags : []).filter(
    (tag) =>
      tag !== AI_CLASSIFIED_TAG &&
      tag !== AI_PENDING_TAG &&
      tag !== PLAID_FALLBACK_TAG
  )
}
