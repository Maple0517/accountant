// ============================================================
// Budget Adapter — Row → Domain Transformations
// ============================================================
// Pure functions. No DB calls, no side effects.
// Maps Supabase row shapes to BudgetEngine input types.
// ============================================================

import type { Category, Transaction, Budget, Profile } from '@/types';
import { DEFAULT_CATEGORIES } from '@/lib/categories';
import { getBudgetDate } from '@/lib/transactions/refunds';
import type {
  BudgetCategoryInput,
  BudgetTransactionInput,
  BudgetRuleInput,
  BudgetSettingsInput,
} from './budget.types';

/**
 * Maps category rows to BudgetCategoryInput[].
 *
 * - `type` is passed through directly (DB uses 'income' | 'expense' | 'transfer').
 * - Non-expense categories and explicitly excluded categories are excluded
 *   from budgeting.
 * - `groupId` is always null (no group concept in the DB yet).
 */
export function adaptCategories(rows: Category[]): BudgetCategoryInput[] {
  return rows.map((row) => {
    const canonical = DEFAULT_CATEGORIES.find((defaultCategory) =>
      defaultCategory.name === row.name ||
      defaultCategory.name_zh === row.name ||
      defaultCategory.name === row.name_zh ||
      defaultCategory.name_zh === row.name_zh
    )

    return {
      id: row.id,
      name: canonical?.name || row.name,
      nameZh: canonical?.name_zh || (row.name_zh ?? null),
      groupId: null,
      type: row.type,
      isExcludedFromBudget:
        row.type !== 'expense' || row.is_excluded_from_budget === true,
      sortOrder: row.sort_order,
    }
  });
}

/**
 * Maps transaction rows to BudgetTransactionInput[].
 *
 * Accountant stores Plaid amounts as positive expenses and negative credits.
 * Refunds remain negative expense-category rows, so the engine can calculate
 * net spending with a plain SUM(amount).
 *
 * Uses the `categoryMap` to resolve each transaction's type from its linked
 * category. Falls back to `'expense'` when the category is missing or
 * unrecognised so uncategorized outflows can still participate in filtering.
 */
export function adaptTransactions(
  rows: Transaction[],
  categoryMap: Map<string, Category>,
  budgetCategoryByTransactionId: Map<string, string | null> = new Map(),
): BudgetTransactionInput[] {
  return rows.map((row) => {
    const budgetCategoryId = budgetCategoryByTransactionId.has(row.id)
      ? budgetCategoryByTransactionId.get(row.id) ?? null
      : row.category_id ?? null
    const category = budgetCategoryId
      ? categoryMap.get(budgetCategoryId)
      : undefined;

    const type = category?.type ?? 'expense';
    const rawAmount = Number(row.amount);

    return {
      id: row.id,
      amount: rawAmount,
      date: getBudgetDate(row),
      categoryId: budgetCategoryId,
      type,
      treatment: row.treatment ?? null,
      refundSource: row.refund_source ?? null,
      status: row.pending ? ('pending' as const) : ('posted' as const),
      isHidden: row.is_hidden_from_reports === true,
      isDeleted: row.deleted_at != null,
    };
  });
}

/**
 * Maps budget rows to BudgetRuleInput[].
 *
 * Each row in the `budgets` table represents a specific month+year
 * override, so `mode` is always `'monthly_override'`.
 *
 * `amount` is explicitly cast to `Number` because Supabase may return
 * PostgreSQL NUMERIC columns as strings.
 */
export function adaptBudgetRules(rows: Budget[]): BudgetRuleInput[] {
  return rows.map((row) => ({
    categoryId: row.category_id,
    month:
      row.month != null && row.year != null
        ? `${row.year}-${String(row.month).padStart(2, '0')}`
        : undefined,
    amount: Number(row.amount),
    mode: 'monthly_override' as const,
  }));
}

/**
 * Derives BudgetSettingsInput from a profile row.
 *
 * The profiles table has no budget-specific columns yet, so this
 * returns safe defaults for phase 1.
 */
export function adaptSettings(_profile: Profile | null): BudgetSettingsInput {
  void _profile

  return {
    budgetingEnabled: true,
    includePendingTransactions: false,
  };
}
