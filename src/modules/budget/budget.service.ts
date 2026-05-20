import type { SupabaseClient } from '@supabase/supabase-js'
import type { MonthlyBudgetSummary, CategoryBudgetSummary } from './budget.types'
import { calculateMonthlySummary } from './budget.engine'
import { adaptCategories, adaptTransactions, adaptBudgetRules, adaptSettings } from './budget.adapter'
import {
  loadCategoriesForBudget,
  loadTransactionsForBudgetMonth,
  loadBudgetRulesForMonth,
  loadBudgetSettings,
  upsertCategoryBudget,
} from './budget.repository'

function validateMonthFormat(month: string): void {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('Invalid month format: expected YYYY-MM')
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
  validateMonthFormat(month)

  const { numericYear, numericMonth, monthStart, monthEnd } = parseMonth(month)

  const categories = await loadCategoriesForBudget(supabase, userId)
  const transactions = await loadTransactionsForBudgetMonth(supabase, userId, monthStart, monthEnd)
  const budgetRules = await loadBudgetRulesForMonth(supabase, userId, numericMonth, numericYear)
  const profile = await loadBudgetSettings(supabase, userId)

  const categoryMap = new Map(categories.map((c) => [c.id, c]))

  const adaptedCategories = adaptCategories(categories)
  const adaptedTransactions = adaptTransactions(transactions, categoryMap)
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
  if (amount < 0) {
    throw new Error('Amount must be non-negative')
  }
  validateMonthFormat(month)

  const { numericMonth, numericYear } = parseMonth(month)

  await upsertCategoryBudget(supabase, userId, categoryId, numericMonth, numericYear, amount)
}
