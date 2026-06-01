import type { SupabaseClient } from '@supabase/supabase-js'
import { filterByCurrency, normalizeCurrencyCode } from '@/lib/money/currency'
import { deriveTransactionTreatment } from '@/lib/transactions/treatment'
import type { MonthlyBudgetSummary, CategoryBudgetSummary } from './budget.types'
import { calculateMonthlySummary } from './budget.engine'
import { adaptCategories, adaptTransactions, adaptSettings } from './budget.adapter'
import {
  loadCategoriesForBudget,
  loadTransactionsForBudgetMonth,
  loadLinkedOriginalTransactionsForBudget,
  loadBudgetRulesForMonth,
  loadBudgetSettings,
  upsertCategoryBudget,
} from './budget.repository'
import type { BudgetRuleInput } from './budget.types'
import type { Budget } from '@/types'

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

function resolveEffectiveBudgetRules(
  rows: Budget[],
  month: string,
  numericMonth: number,
  numericYear: number
): BudgetRuleInput[] {
  const sorted = [...rows].sort((left, right) => {
    const yearDelta = Number(right.year ?? 0) - Number(left.year ?? 0)
    if (yearDelta !== 0) return yearDelta
    return Number(right.month ?? 0) - Number(left.month ?? 0)
  })

  const seen = new Set<string>()

  return sorted.flatMap((row) => {
    if (!row.category_id || seen.has(row.category_id)) {
      return []
    }

    seen.add(row.category_id)

    return [
      {
        categoryId: row.category_id,
        month,
        amount: Number(row.amount),
        mode:
          row.month === numericMonth && row.year === numericYear
            ? 'monthly_override'
            : 'same_every_month',
      } satisfies BudgetRuleInput,
    ]
  })
}

export async function getMonthlySummary(
  supabase: SupabaseClient,
  userId: string,
  month: string,
): Promise<MonthlyBudgetSummary> {
  validateMonth(month)

  const { numericYear, numericMonth, monthStart, monthEnd } = parseMonth(month)

  const [categories, transactions, budgetRules, profile] = await Promise.all([
    loadCategoriesForBudget(supabase, userId),
    loadTransactionsForBudgetMonth(supabase, userId, monthStart, monthEnd),
    loadBudgetRulesForMonth(supabase, userId, numericMonth, numericYear),
    loadBudgetSettings(supabase, userId),
  ])
  const budgetCurrency = normalizeCurrencyCode(profile?.default_currency)
  const currencyTransactions = filterByCurrency(
    transactions,
    budgetCurrency,
    (tx) => tx.iso_currency_code
  )
  const linkedTransactionIds = Array.from(
    new Set(
      currencyTransactions
        .filter(
          (tx) =>
            deriveTransactionTreatment({
              treatment: tx.treatment,
              transactionKind: tx.transaction_kind,
              budgetBehavior: tx.budget_behavior,
            }) === 'refund' &&
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

  const categoryMap = new Map(categories.map((c) => [c.id, c]))
  const originalCategoryById = new Map(
    linkedOriginals.map((tx) => [tx.id, tx.category_id ?? null])
  )
  const budgetCategoryByTransactionId = new Map(
    currencyTransactions
      .filter(
        (tx) =>
          deriveTransactionTreatment({
            treatment: tx.treatment,
            transactionKind: tx.transaction_kind,
            budgetBehavior: tx.budget_behavior,
          }) === 'refund' &&
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
    currencyTransactions,
    categoryMap,
    budgetCategoryByTransactionId
  )
  const adaptedRules = resolveEffectiveBudgetRules(
    budgetRules,
    month,
    numericMonth,
    numericYear
  )
  const settings = adaptSettings(profile)

  return {
    ...calculateMonthlySummary({
      userId,
      month,
      categories: adaptedCategories,
      transactions: adaptedTransactions,
      budgetRules: adaptedRules,
      settings,
    }),
    currencyCode: budgetCurrency,
  }
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
  const category = categories.find((candidate) => candidate.id === categoryId)

  if (!category) {
    throw new Error('Category not found for user')
  }

  if (category.type !== 'expense' || category.is_excluded_from_budget === true) {
    throw new Error('Category is not budgetable')
  }

  await upsertCategoryBudget(supabase, userId, categoryId, numericMonth, numericYear, amount)
}
