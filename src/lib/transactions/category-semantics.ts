import type {
  RefundSource,
  TransactionKind,
  TransactionTreatment,
} from '@/types'
import { normalizeTransactionSemantics } from '@/lib/transactions/treatment'

type CategorySemantics = {
  type?: 'income' | 'expense' | 'transfer' | null
  is_excluded_from_budget?: boolean | null
} | null

export function deriveCategoryChangeSemantics({
  amount,
  treatment,
  refundSource,
  transactionKind,
  category,
}: {
  amount?: number | null
  treatment?: TransactionTreatment | null
  refundSource?: RefundSource | null
  transactionKind?: TransactionKind | null
  category: CategorySemantics
}) {
  const preservesRefund =
    treatment === 'refund' ||
    transactionKind === 'refund' ||
    transactionKind === 'reimbursement'

  if (preservesRefund) {
    return normalizeTransactionSemantics({
      treatment: 'refund',
      refundSource,
      transactionKind,
      amount,
      category,
    })
  }

  if (category?.type === 'transfer') {
    return normalizeTransactionSemantics({
      treatment: 'transfer',
      amount,
      category,
    })
  }

  if (category?.is_excluded_from_budget === true) {
    return normalizeTransactionSemantics({
      treatment: 'excluded',
      amount,
      category,
    })
  }

  if (category?.type === 'income') {
    return normalizeTransactionSemantics({
      treatment: 'income',
      amount,
      category,
    })
  }

  return normalizeTransactionSemantics({
    treatment: typeof amount === 'number' && amount < 0 ? 'income' : 'spending',
    amount,
    category,
  })
}
