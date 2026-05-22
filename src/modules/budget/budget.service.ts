import type { SupabaseClient } from '@supabase/supabase-js'
import type { MonthlyBudgetSummary, CategoryBudgetSummary } from './budget.types'
import { calculateMonthlySummary } from './budget.engine'
import { adaptCategories, adaptTransactions, adaptBudgetRules, adaptSettings } from './budget.adapter'
import {
  loadCategoriesForBudget,
  loadTransactionsForBudgetMonth,
  loadLinkedOriginalTransactionsForBudget,
  loadBudgetRulesForMonth,
  loadBudgetSettings,
  upsertCategoryBudget,
} from './budget.repository'

function isValidMonthString(month: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return false
  }

  const numericMonth = Number(month.slice(5, 7))
  return Number.isInteger(numericMonth) && numericMonth >= 1 && numericMonth <= 12
}

function validateMonth(month: string): void {
  if (!isValidMonthString(month)) {
    throw new Error('Invalid month format: expected YYYY-MM')
  }
}

function validateCategoryId(categoryId: string): void {
  if (categoryId.trim().length === 0) {
    throw new Error('categoryId is required')
  }
}

function parseMonth(month: string): { numericYear: number; numericMonth: number; monthStart: string; monthEnd: string } {
  const numericYear = parseInt(month.slice(0, 4))
  const numericMonth = parseInt(month.slice(5, 7))
  const paddedMonth = String(numericMonth).padStart(2, '0')
  const monthStart = `${numericYear}-${paddedMonth}-01`

  let nextYear: number
  let nextMonth: number
  if (numericMonth === 12) {
    nextYear = numericYear + 1
    nextMonth = 1
  } else {
    nextYear = numericYear
    nextMonth = numericMonth + 1
  }
  const paddedNextMonth = String(nextMonth).padStart(2, '0')
  const monthEnd = `${nextYear}-${paddedNextMonth}-01`

  return { numericYear, numericMonth, monthStart, monthEnd }
}

export async function getMonthlySummary(
  supabase: SupabaseClient,
  userId: string,
  month: string,
): Promise<MonthlyBudgetSummary> {
  validateMonth(month)

  const { numericYear, numericMonth, monthStart, monthEnd } = parseMonth(month)

  const categories = await loadCategoriesForBudget(supabase, userId)
  const transactions = await loadTransactionsForBudgetMonth(supabase, userId, monthStart, monthEnd)
  const linkedTransactionIds = Array.from(
    new Set(
      transactions
        .filter(
          (tx) =>
            (tx.transaction_kind === 'refund' ||
              tx.transaction_kind === 'reimbursement') &&
            tx.linked_transaction_id
        )
        .map((tx) => tx.linked_transaction_id!)
    )
  )
  const linkedOriginals = await loadLinkedOriginalTransactionsForBudget(
    supabase,
    userId,
    linkedTransactionIds
  )
  const budgetRules = await loadBudgetRulesForMonth(supabase, userId, numericMonth, numericYear)
  const profile = await loadBudgetSettings(supabase, userId)

  const categoryMap = new Map(categories.map((c) => [c.id, c]))
  const originalCategoryById = new Map(
    linkedOriginals.map((tx) => [tx.id, tx.category_id ?? null])
  )
  const budgetCategoryByTransactionId = new Map(
    transactions
      .filter(
        (tx) =>
          (tx.transaction_kind === 'refund' ||
            tx.transaction_kind === 'reimbursement') &&
          tx.linked_transaction_id &&
          originalCategoryById.has(tx.linked_transaction_id)
      )
      .map((tx) => [
        tx.id,
        originalCategoryById.get(tx.linked_transaction_id!) ?? null,
      ])
  )

  const adaptedCategories = adaptCategories(categories)
  const adaptedTransactions = adaptTransactions(
    transactions,
    categoryMap,
    budgetCategoryByTransactionId
  )
  const adaptedRules = adaptBudgetRules(budgetRules)
  const settings = adaptSettings(profile)

  return calculateMonthlySummary({
    userId,
    month,
    categories: adaptedCategories,
    transactions: adaptedTransactions,
    budgetRules: adaptedRules,
    settings,
  })
}

export async function getCategorySummary(
  supabase: SupabaseClient,
  userId: string,
  categoryId: string,
  month: string,
): Promise<CategoryBudgetSummary | null> {
  const summary = await getMonthlySummary(supabase, userId, month)
  return summary.categories.find((c) => c.categoryId === categoryId) ?? null
}

export async function updateCategoryBudget(
  supabase: SupabaseClient,
  userId: string,
  categoryId: string,
  month: string,
  amount: number,
): Promise<void> {
  if (!Number.isFinite(amount)) {
    throw new Error('Amount must be a finite number')
  }
  if (amount < 0) {
    throw new Error('Amount must be non-negative')
  }

  validateCategoryId(categoryId)
  validateMonth(month)

  const { numericMonth, numericYear } = parseMonth(month)
  const categories = await loadCategoriesForBudget(supabase, userId)
  const categoryExists = categories.some((category) => category.id === categoryId)

  if (!categoryExists) {
    throw new Error('Category not found for user')
  }

  await upsertCategoryBudget(supabase, userId, categoryId, numericMonth, numericYear, amount)
}
