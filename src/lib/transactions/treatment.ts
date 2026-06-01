import type { RefundSource, TransactionTreatment } from '@/types'

type CategoryBudgetSemantics = {
  type?: 'income' | 'expense' | 'transfer' | null
  is_excluded_from_budget?: boolean | null
} | null | undefined

type TransactionSemanticInput = {
  treatment?: TransactionTreatment | string | null
  refundSource?: RefundSource | string | null
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
  category,
  transactionType,
}: TransactionSemanticInput): TransactionTreatment {
  if (isTransactionTreatment(treatment)) {
    return treatment
  }

  if (transactionType === 'transfer' || category?.type === 'transfer') {
    return 'transfer'
  }

  if (category?.is_excluded_from_budget === true) {
    return 'excluded'
  }

  if (transactionType === 'income' || category?.type === 'income') {
    return 'income'
  }

  return 'spending'
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

    return { treatment: 'income', refundSource: null }
  }

  if (treatment === 'spending' || treatment === 'transfer' || treatment === 'excluded') {
    return { treatment, refundSource: null }
  }

  return { treatment: 'spending', refundSource: null }
}

export function normalizeTransactionSemantics(
  input: TransactionSemanticInput
): {
  treatment: TransactionTreatment
  refundSource: RefundSource | null
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

  return {
    treatment: coerced.treatment,
    refundSource:
      coerced.treatment === 'refund'
        ? (coerced.refundSource ?? 'merchant_refund')
        : null,
  }
}

export function isRefundTreatment(
  input: Pick<TransactionSemanticInput, 'treatment'>
) {
  return deriveTransactionTreatment(input) === 'refund'
}

export function isTransferTreatment(
  input: Pick<TransactionSemanticInput, 'treatment' | 'category' | 'transactionType'>
) {
  return deriveTransactionTreatment(input) === 'transfer'
}
