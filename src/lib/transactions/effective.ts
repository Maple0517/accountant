import type { BudgetBehavior, TransactionSplitRole } from '@/types'

export type EffectiveTransactionFields = {
  amount: number | string
  date: string
  budget_effective_date?: string | null
  effective_date?: string | null
  budget_behavior?: BudgetBehavior | string | null
  category_is_excluded_from_budget?: boolean | null
  deleted_at?: string | null
  is_hidden_from_reports?: boolean | null
  split_role?: TransactionSplitRole | string | null
}

export type TransactionSemanticAmounts = {
  netSpending: number
  income: number
  categoryNetSpend: number
}

export const EFFECTIVE_TRANSACTION_SELECT_FIELDS = [
  'deleted_at',
  'deleted_reason',
  'is_hidden_from_reports',
  'split_group_id',
  'split_parent_id',
  'split_role',
  'split_sequence',
  'split_status',
  'effective_date',
] as const

export function isDeletedTransaction(
  tx: Pick<EffectiveTransactionFields, 'deleted_at'>
) {
  return tx.deleted_at != null
}

export function isSplitParent(
  tx: Pick<EffectiveTransactionFields, 'split_role'>
) {
  return tx.split_role === 'parent'
}

export function isHiddenFromReports(
  tx: Pick<EffectiveTransactionFields, 'is_hidden_from_reports'>
) {
  return tx.is_hidden_from_reports === true
}

export function isEffectiveTransaction(tx: EffectiveTransactionFields) {
  return (
    !isDeletedTransaction(tx) &&
    !isHiddenFromReports(tx) &&
    !isSplitParent(tx)
  )
}

export function getBudgetDate(
  tx: Pick<
    EffectiveTransactionFields,
    'date' | 'budget_effective_date' | 'effective_date'
  >
) {
  return tx.effective_date || tx.budget_effective_date || tx.date
}

export function getEffectiveTransactions<T extends EffectiveTransactionFields>(
  rows: T[]
) {
  return rows.filter(isEffectiveTransaction)
}

export function getTransactionSemanticAmounts(
  tx: Pick<EffectiveTransactionFields, 'amount' | 'budget_behavior'>
): TransactionSemanticAmounts {
  const amount = Number(tx.amount)

  if (!Number.isFinite(amount)) {
    return { netSpending: 0, income: 0, categoryNetSpend: 0 }
  }

  if (
    tx.budget_behavior === 'exclude_as_transfer' ||
    tx.budget_behavior === 'exclude_manual'
  ) {
    return { netSpending: 0, income: 0, categoryNetSpend: 0 }
  }

  if (tx.budget_behavior === 'count_as_income') {
    return { netSpending: 0, income: Math.abs(amount), categoryNetSpend: 0 }
  }

  if (tx.budget_behavior === 'count_as_spending') {
    return { netSpending: amount, income: 0, categoryNetSpend: amount }
  }

  if (amount > 0) {
    return { netSpending: amount, income: 0, categoryNetSpend: amount }
  }

  if (amount < 0) {
    return { netSpending: 0, income: Math.abs(amount), categoryNetSpend: 0 }
  }

  return { netSpending: 0, income: 0, categoryNetSpend: 0 }
}

export function getBudgetSemanticAmounts(
  tx: Pick<
    EffectiveTransactionFields,
    'amount' | 'budget_behavior' | 'category_is_excluded_from_budget'
  >
): TransactionSemanticAmounts {
  if (tx.category_is_excluded_from_budget === true) {
    return { netSpending: 0, income: 0, categoryNetSpend: 0 }
  }

  return getTransactionSemanticAmounts(tx)
}
