import { randomUUID } from 'crypto'
import type { TransferMatchStatus } from '@/types'

export type TransferAccountContext = {
  id: string
  name?: string | null
  type: 'checking' | 'savings' | 'credit' | 'cash' | 'investment' | 'other'
  subtype?: string | null
}

export type TransferMatchTransaction = {
  id: string
  accountId: string
  amount: number
  date: string
  name: string
  merchantName?: string | null
  account: TransferAccountContext
}

export type TransferSemanticTreatment = {
  treatment?: 'transfer'
  transferGroupId: string | null
  transferMatchStatus: Extract<
    TransferMatchStatus,
    'auto_matched' | 'suggested' | 'unmatched'
  >
  transferMatchConfidence: number
  transferMatchReason: string
}

const AUTO_MATCH_THRESHOLD = 75
const SUGGEST_MATCH_THRESHOLD = 50
const AMOUNT_TOLERANCE = 1
const MAX_DATE_DISTANCE_DAYS = 5

const TRANSFER_KEYWORDS = [
  'payment',
  'credit card payment',
  'payment received',
  'online payment',
  'autopay',
  'auto payment',
  'thank you',
  'transfer',
  'xfer',
  'ach transfer',
  'withdrawal to',
  'deposit from',
]

const CREDIT_PAYMENT_OUT_KEYWORDS = [
  'credit card payment',
  'card payment',
  'cc payment',
  'online payment',
  'autopay',
  'auto payment',
  'payment to',
]

const CREDIT_PAYMENT_RECEIVED_KEYWORDS = [
  'payment received',
  'thank you',
  'online payment',
  'autopay',
  'auto payment',
  'automatic payment',
]

const FEE_OR_INTEREST_KEYWORDS = [
  'interest charge',
  'interest charged',
  'late fee',
  'bank fee',
  'atm fee',
  'overdraft fee',
  'wire fee',
  'service charge',
]

function normalizeText(tx: TransferMatchTransaction): string {
  return [tx.name, tx.merchantName].filter(Boolean).join(' ').toLowerCase()
}

function hasAnyKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword))
}

function isFeeOrInterest(text: string) {
  return hasAnyKeyword(text, FEE_OR_INTEREST_KEYWORDS)
}

function dateDistanceDays(a: string, b: string): number {
  const aMs = Date.parse(`${a}T00:00:00Z`)
  const bMs = Date.parse(`${b}T00:00:00Z`)

  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) {
    return Number.POSITIVE_INFINITY
  }

  return Math.abs(aMs - bMs) / 86_400_000
}

function amountDistance(a: number, b: number): number {
  return Math.abs(Math.abs(a) - Math.abs(b))
}

function isOppositeDirection(a: number, b: number) {
  return (a > 0 && b < 0) || (a < 0 && b > 0)
}

function isCheckingLike(account: TransferAccountContext) {
  return account.type === 'checking' || account.type === 'savings'
}

function getAccountPairScore(a: TransferAccountContext, b: TransferAccountContext) {
  const types = new Set([a.type, b.type])

  if (types.has('credit') && (types.has('checking') || types.has('savings'))) {
    return 25
  }

  if (types.has('checking') && types.has('savings')) {
    return 20
  }

  if (types.has('investment') && (types.has('checking') || types.has('savings'))) {
    return 15
  }

  return 0
}

function scorePair(a: TransferMatchTransaction, b: TransferMatchTransaction) {
  if (a.accountId === b.accountId) return null
  if (!isOppositeDirection(a.amount, b.amount)) return null

  const textA = normalizeText(a)
  const textB = normalizeText(b)
  if (isFeeOrInterest(textA) || isFeeOrInterest(textB)) return null

  const pairScore = getAccountPairScore(a.account, b.account)
  if (pairScore === 0) return null

  const distance = dateDistanceDays(a.date, b.date)
  if (distance > MAX_DATE_DISTANCE_DAYS) return null

  const amountGap = amountDistance(a.amount, b.amount)
  const amountTolerance = Math.max(AMOUNT_TOLERANCE, Math.abs(a.amount) * 0.01)
  if (amountGap > amountTolerance) return null

  const hasTransferLanguage = hasAnyKeyword(`${textA} ${textB}`, TRANSFER_KEYWORDS)
  if (!hasTransferLanguage) return null

  let score = 0
  score += amountGap <= 0.01 ? 40 : 30
  score += distance === 0 ? 25 : distance <= 2 ? 15 : 8
  score += pairScore
  score += 20

  return {
    score,
    reason:
      a.account.type === 'credit' || b.account.type === 'credit'
        ? 'matched credit card payment legs'
        : 'matched internal transfer legs',
  }
}

function scoreSingleSidedCreditPayment(tx: TransferMatchTransaction) {
  const text = normalizeText(tx)
  if (isFeeOrInterest(text)) return null

  const checkingPaymentOut =
    isCheckingLike(tx.account) &&
    tx.amount > 0 &&
    hasAnyKeyword(text, CREDIT_PAYMENT_OUT_KEYWORDS) &&
    text.includes('card')
  const creditPaymentReceived =
    tx.account.type === 'credit' &&
    tx.amount < 0 &&
    hasAnyKeyword(text, CREDIT_PAYMENT_RECEIVED_KEYWORDS)

  if (!checkingPaymentOut && !creditPaymentReceived) {
    return null
  }

  return {
    score: 80,
    reason: checkingPaymentOut
      ? 'single-sided credit card payment outflow'
      : 'single-sided credit card payment received',
  }
}

function treatment(
  status: TransferSemanticTreatment['transferMatchStatus'],
  confidence: number,
  reason: string,
  transferGroupId: string | null,
  shouldExclude: boolean
): TransferSemanticTreatment {
  return {
    ...(shouldExclude
      ? {
          treatment: 'transfer' as const,
        }
      : {}),
    transferGroupId,
    transferMatchStatus: status,
    transferMatchConfidence: confidence,
    transferMatchReason: reason,
  }
}

export function detectTransferSemantics(
  transactions: TransferMatchTransaction[],
  groupIdFactory: () => string = randomUUID
): Map<string, TransferSemanticTreatment> {
  const treatments = new Map<string, TransferSemanticTreatment>()
  const pairCandidates: Array<{
    a: TransferMatchTransaction
    b: TransferMatchTransaction
    score: number
    reason: string
  }> = []

  for (let i = 0; i < transactions.length; i += 1) {
    for (let j = i + 1; j < transactions.length; j += 1) {
      const score = scorePair(transactions[i], transactions[j])
      if (score && score.score >= SUGGEST_MATCH_THRESHOLD) {
        pairCandidates.push({
          a: transactions[i],
          b: transactions[j],
          score: score.score,
          reason: score.reason,
        })
      }
    }
  }

  pairCandidates.sort((a, b) => b.score - a.score)

  for (const candidate of pairCandidates) {
    if (treatments.has(candidate.a.id) || treatments.has(candidate.b.id)) {
      continue
    }

    const groupId = groupIdFactory()
    const roundedScore = Math.min(100, candidate.score)
    const isAutoMatch = candidate.score >= AUTO_MATCH_THRESHOLD
    const status = isAutoMatch ? 'auto_matched' : 'suggested'
    const reason = isAutoMatch
      ? candidate.reason
      : `possible ${candidate.reason}`
    treatments.set(
      candidate.a.id,
      treatment(status, roundedScore, reason, groupId, isAutoMatch)
    )
    treatments.set(
      candidate.b.id,
      treatment(status, roundedScore, reason, groupId, isAutoMatch)
    )
  }

  for (const tx of transactions) {
    if (treatments.has(tx.id)) continue

    const singleSided = scoreSingleSidedCreditPayment(tx)
    if (!singleSided) continue

    treatments.set(
      tx.id,
      treatment('unmatched', singleSided.score, singleSided.reason, null, true)
    )
  }

  return treatments
}
