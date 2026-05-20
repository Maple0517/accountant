// ============================================================
// Budget Adapter — Row → Domain Transformations
// ============================================================
// Pure functions. No DB calls, no side effects.
// Maps Supabase row shapes to BudgetEngine input types.
// ============================================================

import type { Category, Transaction, Budget, Profile } from '@/types';
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
 * - Non-expense categories are excluded from budgeting.
 * - `groupId` is always null (no group concept in the DB yet).
 */
export function adaptCategories(rows: Category[]): BudgetCategoryInput[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    groupId: null,
    type: row.type,
    isExcludedFromBudget: row.type !== 'expense',
    sortOrder: row.sort_order,
  }));
}

/**
 * Maps transaction rows to BudgetTransactionInput[].
 *
 * Amount sign is normalised here, not in the engine. Across the current app,
 * the dominant storage convention is:
 * - negative amount = expense
 * - positive amount = income
 *
 * BudgetEngine should not need to know or guess that persistence detail, so
 * expense-like transactions are converted to a negative spend amount and
 * income-like transactions are converted to a positive inflow amount.
 *
 * Uses the `categoryMap` to resolve each transaction's type from its linked
 * category. Falls back to `'expense'` when the category is missing or
 * unrecognised so uncategorized outflows can still participate in filtering.
 */
export function adaptTransactions(
  rows: Transaction[],
  categoryMap: Map<string, Category>,
): BudgetTransactionInput[] {
  return rows.map((row) => {
    const category = row.category_id
      ? categoryMap.get(row.category_id)
      : undefined;

    const type = category?.type ?? 'expense';
    const rawAmount = Number(row.amount);

    let normalizedAmount = rawAmount;
    if (type === 'expense') {
      normalizedAmount = -Math.abs(rawAmount);
    } else if (type === 'income') {
      normalizedAmount = Math.abs(rawAmount);
    }

    return {
      id: row.id,
      amount: normalizedAmount,
      date: row.date,
      categoryId: row.category_id ?? null,
      type,
      status: row.pending ? ('pending' as const) : ('posted' as const),
      isHidden: false,
      isDeleted: false,
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
  return {
    budgetingEnabled: true,
    includePendingTransactions: false,
  };
}
