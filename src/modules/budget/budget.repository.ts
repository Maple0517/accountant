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
    .select('*')
    .eq('user_id', userId)
    .order('sort_order');

  if (error) {
    console.error('[budget.repository] loadCategoriesForBudget failed:', error.message);
    return [];
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
    .select('*')
    .eq('user_id', userId)
    .or(
      `and(budget_effective_date.gte.${monthStart},budget_effective_date.lt.${monthEnd}),and(budget_effective_date.is.null,date.gte.${monthStart},date.lt.${monthEnd})`,
    );

  if (error) {
    console.error('[budget.repository] loadTransactionsForBudgetMonth failed:', error.message);
    return [];
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
    .select('*')
    .eq('user_id', userId)
    .eq('month', month)
    .eq('year', year)
    .eq('period', 'monthly');

  if (error) {
    console.error('[budget.repository] loadBudgetRulesForMonth failed:', error.message);
    return [];
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
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('[budget.repository] loadBudgetSettings failed:', error.message);
    return null;
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
