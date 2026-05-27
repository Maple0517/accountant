import type { TransactionSplitRole } from '@/types'

export type TransactionMutationGuardFields = {
  deleted_at?: string | null
  split_role?: TransactionSplitRole | string | null
}

export type TransactionMutationKind =
  | 'category'
  | 'refund_metadata'
  | 'semantics'

export function getTransactionMutationBlockReason(
  tx: TransactionMutationGuardFields
) {
  if (tx.deleted_at != null) {
    return 'Deleted transactions cannot be edited'
  }

  if (tx.split_role === 'parent') {
    return 'Split parent transactions cannot be edited directly'
  }

  return null
}

export function canApplySimilarCategoryUpdate(tx: TransactionMutationGuardFields) {
  return tx.deleted_at == null && tx.split_role !== 'child' && tx.split_role !== 'parent'
}
