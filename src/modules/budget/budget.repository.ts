// ============================================================
// Budget Repository — Supabase Data Access
// ============================================================
// CRUD-only. No calculations, no transformation logic.
// Every function receives a SupabaseClient so callers control
// the client lifecycle (server component, route handler, etc.).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Category, Transaction, Budget, Profile } from '@/types';

/**
 * Loads all categories for a user, ordered by `sort_order`.
 */
export async function loadCategoriesForBudget(
  supabase: SupabaseClient,
  userId: string,
): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, user_id, name, name_zh, icon, color, type, is_excluded_from_budget, sort_order, created_at')
    .eq('user_id', userId)
    .order('sort_order');

  if (error) {
    throw new Error(`[budget.repository] loadCategoriesForBudget failed: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Loads transactions for a user within a budget-effective date range
 * (inclusive start, exclusive end).
 *
 * @param monthStart - First day of the month, e.g. `'2026-05-01'`
 * @param monthEnd   - First day of the *next* month, e.g. `'2026-06-01'`
 */
export async function loadTransactionsForBudgetMonth(
  supabase: SupabaseClient,
  userId: string,
  monthStart: string,
  monthEnd: string,
): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, user_id, account_id, category_id, amount, date, pending, source, description, created_at, updated_at, transaction_kind, budget_behavior, linked_transaction_id, budget_effective_date')
    .eq('user_id', userId)
    .or(
      `and(budget_effective_date.gte.${monthStart},budget_effective_date.lt.${monthEnd}),and(budget_effective_date.is.null,date.gte.${monthStart},date.lt.${monthEnd})`,
    );

  if (error) {
    throw new Error(`[budget.repository] loadTransactionsForBudgetMonth failed: ${error.message}`);
  }

  return data ?? [];
}

export async function loadLinkedOriginalTransactionsForBudget(
  supabase: SupabaseClient,
  userId: string,
  linkedTransactionIds: string[],
): Promise<Pick<Transaction, 'id' | 'category_id'>[]> {
  if (linkedTransactionIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('transactions')
    .select('id, category_id')
    .eq('user_id', userId)
    .in('id', linkedTransactionIds);

  if (error) {
    throw new Error(`[budget.repository] loadLinkedOriginalTransactionsForBudget failed: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Loads monthly budget rules for a specific month+year.
 */
export async function loadBudgetRulesForMonth(
  supabase: SupabaseClient,
  userId: string,
  month: number,
  year: number,
): Promise<Budget[]> {
  const { data, error } = await supabase
    .from('budgets')
    .select('id, user_id, category_id, amount, period, month, year, alert_threshold, created_at, updated_at')
    .eq('user_id', userId)
    .eq('month', month)
    .eq('year', year)
    .eq('period', 'monthly');

  if (error) {
    throw new Error(`[budget.repository] loadBudgetRulesForMonth failed: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Loads the user's profile (used to derive budget settings).
 * Returns `null` when the profile does not exist or on error.
 */
export async function loadBudgetSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, default_currency, notion_sync_enabled, created_at, updated_at')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(`[budget.repository] loadBudgetSettings failed: ${error.message}`);
  }

  return data ?? null;
}

/**
 * Upserts a category budget for a given month+year.
 *
 * Uses the unique constraint `(user_id, category_id, month, year)`
 * to decide between INSERT and UPDATE.
 *
 * @throws Error when the upsert fails.
 */
export async function upsertCategoryBudget(
  supabase: SupabaseClient,
  userId: string,
  categoryId: string,
  month: number,
  year: number,
  amount: number,
): Promise<void> {
  const { error } = await supabase.from('budgets').upsert(
    {
      user_id: userId,
      category_id: categoryId,
      month,
      year,
      amount,
      period: 'monthly' as const,
    },
    { onConflict: 'user_id,category_id,month,year' },
  );

  if (error) {
    throw new Error(
      `[budget.repository] upsertCategoryBudget failed: ${error.message}`,
    );
  }
}
