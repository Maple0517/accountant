// ============================================================
// Budget Domain Types
// ============================================================
// Pure data contracts for the Budget module.
// No runtime dependencies — no DB, ORM, React, or Next.js imports.
// ============================================================

import type { BudgetBehavior } from '@/types';

// ------ Engine Input Types ------

export interface BudgetEngineInput {
  userId: string;
  month: string; // YYYY-MM
  categories: BudgetCategoryInput[];
  transactions: BudgetTransactionInput[];
  budgetRules: BudgetRuleInput[];
  settings: BudgetSettingsInput;
}

export interface BudgetCategoryInput {
  id: string;
  name: string;
  nameZh?: string | null;
  groupId?: string | null;
  type: 'expense' | 'income' | 'transfer' | 'hidden';
  isExcludedFromBudget: boolean;
  sortOrder?: number;
}

export interface BudgetTransactionInput {
  id: string;
  amount: number;
  date: string; // ISO date string (YYYY-MM-DD)
  categoryId: string | null;
  type: 'expense' | 'income' | 'transfer' | 'investment' | 'refund' | 'adjustment';
  budgetBehavior?: BudgetBehavior | null;
  status?: 'posted' | 'pending';
  isHidden?: boolean;
  isDeleted?: boolean;
}

export interface BudgetRuleInput {
  categoryId: string;
  month?: string; // YYYY-MM, optional for default rule
  amount: number;
  mode?: 'same_every_month' | 'monthly_override';
}

export interface BudgetSettingsInput {
  budgetingEnabled: boolean;
  includePendingTransactions: boolean;
}

// ------ Engine Output Types ------

export type BudgetStatus = 'under' | 'near' | 'over' | 'no_budget';

export interface CategoryBudgetSummary {
  categoryId: string;
  categoryName: string;
  categoryNameZh?: string | null;
  groupId?: string | null;
  baseBudget: number;
  actualSpend: number;
  remaining: number;
  percentUsed: number | null;
  status: BudgetStatus;
}

export interface MonthlyBudgetSummary {
  userId: string;
  month: string;
  budgetingEnabled: boolean;
  totalBaseBudget: number;
  totalActualSpend: number;
  totalRemaining: number;
  totalPercentUsed: number | null;
  categories: CategoryBudgetSummary[];
}
