import type { BudgetBehavior, TransactionKind } from '@/types'

type CategoryBudgetSemantics = {
  type?: 'income' | 'expense' | 'transfer' | null
  is_excluded_from_budget?: boolean | null
} | null | undefined

type TransactionSemanticsInput = {
  transactionKind?: TransactionKind | string | null
  category?: CategoryBudgetSemantics
  transactionType?: 'expense' | 'income' | 'transfer' | 'unknown' | null
}

export function deriveBudgetBehavior({
  transactionKind,
  category,
  transactionType,
}: TransactionSemanticsInput): BudgetBehavior {
  if (transactionKind === 'transfer' || transactionType === 'transfer') {
    return 'exclude_as_transfer'
  }

  if (transactionKind === 'refund' || transactionKind === 'reimbursement') {
    return 'count_as_spending'
  }

  if (category?.is_excluded_from_budget === true) {
    return category.type === 'transfer' ? 'exclude_as_transfer' : 'exclude_manual'
  }

  if (category?.type === 'income' || transactionType === 'income') {
    return 'count_as_income'
  }

  if (category?.type === 'transfer') {
    return 'exclude_as_transfer'
  }

  return 'count_as_spending'
}
