// ============================================================
// Budget Calculation Engine
// ============================================================
// Pure, side-effect-free function that computes a MonthlyBudgetSummary
// from raw budget inputs. No DB, no fetch, no React, no Node APIs.
// ============================================================

import type {
  BudgetEngineInput,
  BudgetTransactionInput,
  BudgetStatus,
  CategoryBudgetSummary,
  MonthlyBudgetSummary,
} from './budget.types'

/**
 * Computes the first-of-month date string for the month AFTER `month`.
 * Handles Dec → Jan year rollover.
 */
function getNextMonthStart(month: string): string {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const mon = Number(monthStr)

  if (mon === 12) {
    return `${year + 1}-01-01`
  }
  return `${year}-${String(mon + 1).padStart(2, '0')}-01`
}

/**
 * Determines whether a transaction should be included in spend calculation.
 */
function isIncludedTransaction(
  tx: BudgetTransactionInput,
  monthStart: string,
  nextMonthStart: string,
  includePending: boolean,
  expenseCategoryIds: Set<string>
): boolean {
  // Must be an expense type
  if (tx.type !== 'expense') return false

  // Date must be within the month boundary
  if (tx.date < monthStart || tx.date >= nextMonthStart) return false

  // Must have a categoryId
  if (tx.categoryId === null) return false

  // Category must be a non-excluded expense category
  if (!expenseCategoryIds.has(tx.categoryId)) return false

  // Must not be hidden or deleted
  if (tx.isHidden === true) return false
  if (tx.isDeleted === true) return false

  // Pending check
  if (!includePending && tx.status === 'pending') return false

  return true
}

/**
 * Derives the budget status from baseBudget and actualSpend.
 */
function deriveBudgetStatus(baseBudget: number, actualSpend: number): BudgetStatus {
  if (baseBudget <= 0) return 'no_budget'
  if (actualSpend > baseBudget) return 'over'
  if (actualSpend >= baseBudget * 0.8) return 'near'
  return 'under'
}

/**
 * Calculates a full monthly budget summary from the given inputs.
 */
export function calculateMonthlySummary(input: BudgetEngineInput): MonthlyBudgetSummary {
  const { userId, month, categories, transactions, budgetRules, settings } = input

  const monthStart = `${month}-01`
  const nextMonthStart = getNextMonthStart(month)
  const includePending = settings.includePendingTransactions

  // Identify non-excluded expense categories
  const expenseCategories = categories.filter(
    (c) => c.type === 'expense' && !c.isExcludedFromBudget
  )
  const expenseCategoryIds = new Set(expenseCategories.map((c) => c.id))

  // Build a lookup for budget rules keyed by categoryId
  const ruleMap = new Map<string, number>()
  for (const rule of budgetRules) {
    if (rule.month === month) {
      ruleMap.set(rule.categoryId, rule.amount)
    }
  }

  // Accumulate spend per category
  const spendMap = new Map<string, number>()
  for (const tx of transactions) {
    if (isIncludedTransaction(tx, monthStart, nextMonthStart, includePending, expenseCategoryIds)) {
      const current = spendMap.get(tx.categoryId!) ?? 0
      spendMap.set(tx.categoryId!, current + tx.amount)
    }
  }

  // Build per-category summaries
  let totalBaseBudget = 0
  let totalActualSpend = 0

  const categorySummaries: CategoryBudgetSummary[] = expenseCategories.map((cat) => {
    const baseBudget = ruleMap.get(cat.id) ?? 0
    const actualSpend = spendMap.get(cat.id) ?? 0
    const remaining = baseBudget - actualSpend
    const percentUsed = baseBudget > 0 ? actualSpend / baseBudget : null
    const status = deriveBudgetStatus(baseBudget, actualSpend)

    totalBaseBudget += baseBudget
    totalActualSpend += actualSpend

    return {
      categoryId: cat.id,
      categoryName: cat.name,
      groupId: cat.groupId ?? null,
      baseBudget,
      actualSpend,
      remaining,
      percentUsed,
      status,
    }
  })

  const totalRemaining = totalBaseBudget - totalActualSpend
  const totalPercentUsed = totalBaseBudget > 0 ? totalActualSpend / totalBaseBudget : null

  return {
    userId,
    month,
    budgetingEnabled: settings.budgetingEnabled,
    totalBaseBudget,
    totalActualSpend,
    totalRemaining,
    totalPercentUsed,
    categories: categorySummaries,
  }
}
