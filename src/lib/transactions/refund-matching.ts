import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlaidCategorySource } from '@/lib/plaid/classification'
import { getPlaidPrimaryCategory } from '@/lib/plaid/classification'
import { isRefundLikeAmount } from '@/lib/transactions/refunds'

const EXCLUDED_PRIMARY_CATEGORIES = new Set([
  'INCOME',
  'LOAN_PAYMENTS',
  'TRANSFER_IN',
  'TRANSFER_OUT',
])

const EXCLUDED_DETAIL_PARTS = [
  'PAYROLL',
  'DIRECT_DEPOSIT',
  'CREDIT_CARD_PAYMENT',
  'TRANSFER',
  'LOAN',
]

const INCOME_OR_TRANSFER_WORDS = [
  'payroll',
  'salary',
  'direct deposit',
  'interest paid',
  'dividend',
  'zelle',
  'ach transfer',
  'online transfer',
  'credit card payment',
  'payment thank you',
  'autopay payment',
]

export type RefundCandidateTransaction = PlaidCategorySource & {
  amount: number
  merchant_name?: string | null
  name: string
}

export type OriginalPurchaseCandidate = {
  id: string
  account_id: string
  category_id: string | null
  amount: number
  date: string
  merchant_name: string | null
  description: string
}

export type RefundMatch = {
  original: OriginalPurchaseCandidate
  confidence: number
  reason: string
}

export type FindLikelyOriginalPurchaseInput = {
  supabase: SupabaseClient
  userId: string
  accountId: string
  refundAmountAbs: number
  merchantName: string | null
  refundDate: string
}

function normalizeMerchantName(value: string | null | undefined) {
  return (value || '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|store|online|marketplace|payment)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function daysBetween(start: string, end: string) {
  const startMs = Date.parse(`${start}T00:00:00Z`)
  const endMs = Date.parse(`${end}T00:00:00Z`)
  return Math.round((endMs - startMs) / 86_400_000)
}

function isExcludedCategory(tx: PlaidCategorySource) {
  const primary = getPlaidPrimaryCategory(tx)
  if (primary && EXCLUDED_PRIMARY_CATEGORIES.has(primary)) return true

  const detailed = tx.personal_finance_category?.detailed || ''
  return EXCLUDED_DETAIL_PARTS.some((part) => detailed.includes(part))
}

export function isLikelyRefundCandidate(tx: RefundCandidateTransaction) {
  if (!isRefundLikeAmount(tx.amount)) return false
  if (isExcludedCategory(tx)) return false

  const displayName = `${tx.merchant_name || ''} ${tx.name || ''}`.trim()
  if (!displayName) return false

  const lowerName = displayName.toLocaleLowerCase('en-US')
  if (INCOME_OR_TRANSFER_WORDS.some((word) => lowerName.includes(word))) {
    return false
  }

  return Boolean(normalizeMerchantName(displayName))
}

export async function findLikelyOriginalPurchase({
  supabase,
  userId,
  accountId,
  refundAmountAbs,
  merchantName,
  refundDate,
}: FindLikelyOriginalPurchaseInput): Promise<RefundMatch | null> {
  const windowStart = addDays(refundDate, -120)

  const { data, error } = await supabase
    .from('transactions')
    .select('id, account_id, category_id, amount, date, merchant_name, description')
    .eq('user_id', userId)
    .eq('transaction_kind', 'normal')
    .gt('amount', 0)
    .lte('date', refundDate)
    .gte('date', windowStart)

  if (error) {
    console.error('Error finding original purchase for refund:', error)
    return null
  }

  const refundMerchant = normalizeMerchantName(merchantName)
  let best: RefundMatch | null = null

  for (const candidate of (data || []) as OriginalPurchaseCandidate[]) {
    const purchaseAmount = Number(candidate.amount)
    const amountDelta = Math.abs(purchaseAmount - refundAmountAbs)
    const ageInDays = daysBetween(candidate.date, refundDate)
    const candidateMerchant = normalizeMerchantName(
      candidate.merchant_name || candidate.description
    )
    const reasons: string[] = []
    let score = 0

    if (amountDelta < 0.01) {
      score += 50
      reasons.push('exact amount')
    } else if (refundAmountAbs < purchaseAmount) {
      score += 30
      reasons.push('partial refund')
    }

    if (
      refundMerchant &&
      candidateMerchant &&
      (refundMerchant.includes(candidateMerchant) ||
        candidateMerchant.includes(refundMerchant))
    ) {
      score += 20
      reasons.push('merchant match')
    }

    if (candidate.account_id === accountId) {
      score += 10
      reasons.push('same account')
    }

    if (ageInDays <= 30) {
      score += 10
      reasons.push('within 30 days')
    } else if (ageInDays > 90) {
      score -= 20
      reasons.push('older than 90 days')
    }

    if (!best || score > best.confidence * 100) {
      best = {
        original: candidate,
        confidence: Math.max(0, Math.min(1, score / 100)),
        reason: reasons.join(', ') || 'weak refund match',
      }
    }
  }

  if (!best || best.confidence < 0.6) {
    return null
  }

  return best
}
