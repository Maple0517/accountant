import type {
  BudgetBehavior,
  RefundSource,
  TransactionKind,
  TransactionTreatment,
} from '@/types'

type CategoryBudgetSemantics = {
  type?: 'income' | 'expense' | 'transfer' | null
  is_excluded_from_budget?: boolean | null
} | null | undefined

type TransactionSemanticInput = {
  treatment?: TransactionTreatment | string | null
  refundSource?: RefundSource | string | null
  transactionKind?: TransactionKind | string | null
  budgetBehavior?: BudgetBehavior | string | null
  amount?: number | null
  category?: CategoryBudgetSemantics
  transactionType?: 'expense' | 'income' | 'transfer' | 'unknown' | null
}

const VALID_TREATMENTS = new Set<TransactionTreatment>([
  'spending',
  'income',
  'refund',
  'transfer',
  'excluded',
])

const VALID_REFUND_SOURCES = new Set<RefundSource>([
  'merchant_refund',
  'reimbursement',
])

export function isTransactionTreatment(
  value: string | null | undefined
): value is TransactionTreatment {
  return VALID_TREATMENTS.has(value as TransactionTreatment)
}

export function isRefundSource(
  value: string | null | undefined
): value is RefundSource {
  return VALID_REFUND_SOURCES.has(value as RefundSource)
}

export function deriveTransactionTreatment({
  treatment,
  transactionKind,
  budgetBehavior,
  category,
  transactionType,
}: TransactionSemanticInput): TransactionTreatment {
  if (isTransactionTreatment(treatment)) {
    return treatment
  }

  if (transactionKind === 'refund' || transactionKind === 'reimbursement') {
    return 'refund'
  }

  if (
    transactionKind === 'transfer' ||
    budgetBehavior === 'exclude_as_transfer' ||
    transactionType === 'transfer'
  ) {
    return 'transfer'
  }

  if (budgetBehavior === 'exclude_manual') {
    return 'excluded'
  }

  if (
    budgetBehavior === 'count_as_income' ||
    category?.type === 'income' ||
    transactionType === 'income'
  ) {
    return 'income'
  }

  if (category?.type === 'transfer') {
    return 'transfer'
  }

  if (category?.is_excluded_from_budget === true) {
    return 'excluded'
  }

  return 'spending'
}

export function deriveRefundSourceValue({
  treatment,
  refundSource,
  transactionKind,
}: Pick<TransactionSemanticInput, 'treatment' | 'refundSource' | 'transactionKind'>): RefundSource | null {
  const nextTreatment = isTransactionTreatment(treatment) ? treatment : undefined
  if (nextTreatment && nextTreatment !== 'refund') {
    return null
  }

  if (isRefundSource(refundSource)) {
    return refundSource
  }

  if (transactionKind === 'reimbursement') {
    return 'reimbursement'
  }

  return nextTreatment === 'refund' || transactionKind === 'refund'
    ? 'merchant_refund'
    : null
}

export function deriveBudgetBehaviorFromTreatment(
  treatment: TransactionTreatment
): BudgetBehavior {
  switch (treatment) {
    case 'income':
      return 'count_as_income'
    case 'transfer':
      return 'exclude_as_transfer'
    case 'excluded':
      return 'exclude_manual'
    case 'refund':
    case 'spending':
    default:
      return 'count_as_spending'
  }
}

export function deriveLegacyTransactionKind({
  treatment,
  refundSource,
}: {
  treatment: TransactionTreatment
  refundSource?: RefundSource | null
}): TransactionKind {
  if (treatment === 'refund') {
    return refundSource === 'reimbursement' ? 'reimbursement' : 'refund'
  }

  if (treatment === 'transfer') {
    return 'transfer'
  }

  return 'normal'
}

export function coerceTreatmentForAmount({
  treatment,
  refundSource,
  amount,
}: {
  treatment: TransactionTreatment
  refundSource?: RefundSource | null
  amount?: number | null
}): {
  treatment: TransactionTreatment
  refundSource: RefundSource | null
} {
  const normalizedRefundSource = isRefundSource(refundSource) ? refundSource : null

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
    return {
      treatment,
      refundSource: treatment === 'refund' ? normalizedRefundSource : null,
    }
  }

  if (amount < 0) {
    if (treatment === 'income' || treatment === 'refund') {
      return {
        treatment,
        refundSource: treatment === 'refund' ? normalizedRefundSource : null,
      }
    }

    if (treatment === 'transfer' || treatment === 'excluded') {
      return { treatment, refundSource: null }
    }

    return { treatment: 'income' as TransactionTreatment, refundSource: null }
  }

  if (treatment === 'spending' || treatment === 'transfer' || treatment === 'excluded') {
    return { treatment, refundSource: null }
  }

  return { treatment: 'spending' as TransactionTreatment, refundSource: null }
}

export function isRefundTreatment(
  input: Pick<TransactionSemanticInput, 'treatment' | 'transactionKind'>
) {
  return deriveTransactionTreatment(input) === 'refund'
}

export function isTransferTreatment(
  input: Pick<
    TransactionSemanticInput,
    'treatment' | 'transactionKind' | 'budgetBehavior'
  >
) {
  return deriveTransactionTreatment(input) === 'transfer'
}

export function normalizeTransactionSemantics(
  input: TransactionSemanticInput
): {
  treatment: TransactionTreatment
  refundSource: RefundSource | null
  budgetBehavior: BudgetBehavior
  transactionKind: TransactionKind
} {
  const derivedTreatment = deriveTransactionTreatment(input)
  const normalizedInputRefundSource = isRefundSource(input.refundSource)
    ? input.refundSource
    : null
  const coerced = coerceTreatmentForAmount({
    treatment: derivedTreatment,
    refundSource: normalizedInputRefundSource,
    amount: input.amount,
  })
  const treatment = coerced.treatment
  const refundSource =
    treatment === 'refund'
      ? deriveRefundSourceValue({
          treatment,
          refundSource: coerced.refundSource,
          transactionKind: input.transactionKind,
        })
      : null

  return {
    treatment,
    refundSource,
    budgetBehavior: deriveBudgetBehaviorFromTreatment(treatment),
    transactionKind: deriveLegacyTransactionKind({ treatment, refundSource }),
  }
}
