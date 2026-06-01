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
    .select('id, user_id, account_id, category_id, amount, iso_currency_code, date, pending, source, description, created_at, updated_at, treatment, refund_source, linked_transaction_id, budget_effective_date, effective_date, deleted_at, deleted_reason, is_hidden_from_reports, split_group_id, split_parent_id, split_role, split_sequence, split_status')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .eq('is_hidden_from_reports', false)
    .neq('split_role', 'parent')
    .gte('effective_date', monthStart)
    .lt('effective_date', monthEnd);

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
 * Loads all monthly budget rules up to and including the requested month.
 *
 * The service layer resolves the latest applicable rule per category so a
 * budget set in a previous month can carry forward until overridden.
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
    .eq('period', 'monthly');

  if (error) {
    throw new Error(`[budget.repository] loadBudgetRulesForMonth failed: ${error.message}`);
  }

  return (data ?? []).filter((rule) => {
    if (rule.year == null || rule.month == null) {
      return false
    }

    if (rule.year < year) {
      return true
    }

    return rule.year === year && rule.month <= month
  });
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
