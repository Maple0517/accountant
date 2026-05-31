import type {
  BudgetBehavior,
  RefundSource,
  TransactionKind,
  TransactionTreatment,
} from '@/types'
import { normalizeTransactionSemantics } from '@/lib/transactions/treatment'

type CategoryBudgetSemantics = {
  type?: 'income' | 'expense' | 'transfer' | null
  is_excluded_from_budget?: boolean | null
} | null | undefined

type TransactionSemanticsInput = {
  treatment?: TransactionTreatment | string | null
  refundSource?: RefundSource | string | null
  transactionKind?: TransactionKind | string | null
  budgetBehavior?: BudgetBehavior | string | null
  category?: CategoryBudgetSemantics
  transactionType?: 'expense' | 'income' | 'transfer' | 'unknown' | null
}

export function deriveBudgetBehavior({
  treatment,
  refundSource,
  transactionKind,
  budgetBehavior,
  category,
  transactionType,
}: TransactionSemanticsInput): BudgetBehavior {
  return normalizeTransactionSemantics({
    treatment,
    refundSource,
    transactionKind,
    budgetBehavior,
    category,
    transactionType,
  }).budgetBehavior
}

export function shouldPreserveBudgetBehavior(
  source: string | null | undefined
) {
  return source === 'user' || source === 'rule'
}
