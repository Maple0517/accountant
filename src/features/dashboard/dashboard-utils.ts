import type { DashboardAccount, DashboardMonthTransaction } from './types'
import { isSameCurrency, normalizeCurrencyCode } from '@/lib/money/currency'
import {
  AI_PENDING_TAG,
  PLAID_FALLBACK_TAG,
} from '@/lib/plaid/classification'

export function getMonthlySemanticAmounts(tx: Pick<DashboardMonthTransaction, 'amount' | 'budget_behavior'>) {
  const amount = Number(tx.amount)

  if (!Number.isFinite(amount)) {
    return { spending: 0, income: 0 }
  }

  if (tx.budget_behavior === 'exclude_as_transfer' || tx.budget_behavior === 'exclude_manual') {
    return { spending: 0, income: 0 }
  }

  if (tx.budget_behavior === 'count_as_income') {
    return { spending: 0, income: Math.abs(amount) }
  }

  if (tx.budget_behavior === 'count_as_spending') {
    return { spending: amount, income: 0 }
  }

  if (amount > 0) return { spending: amount, income: 0 }
  if (amount < 0) return { spending: 0, income: Math.abs(amount) }
  return { spending: 0, income: 0 }
}

export function summarizeBalances(accounts: DashboardAccount[], currencyCode: string) {
  const selectedCurrency = normalizeCurrencyCode(currencyCode)

  return accounts.reduce(
    (summary, account) => {
      const balance = Number(account.current_balance || 0)
      if (!Number.isFinite(balance)) return summary
      if (!isSameCurrency(account.iso_currency_code, selectedCurrency)) return summary

      if (account.type === 'credit' || account.type === 'loan') {
        summary.cardDebt += balance
      } else {
        summary.cash += balance
      }

      return summary
    },
    { cash: 0, cardDebt: 0 }
  )
}

export function getReviewCounts(transactions: DashboardMonthTransaction[]) {
  return transactions.reduce(
    (counts, tx) => {
      const tags = Array.isArray(tx.tags) ? tx.tags : []
      const kind = tx.transaction_kind
      if (tags.includes(AI_PENDING_TAG) || tags.includes(PLAID_FALLBACK_TAG)) {
        counts.aiPending += 1
      }
      if (!tx.category_id) counts.uncategorized += 1
      if (kind === 'refund' || kind === 'reimbursement') counts.possibleRefunds += 1
      if (kind === 'transfer' && (!tx.transfer_match_status || tx.transfer_match_status === 'unmatched' || tx.transfer_match_status === 'suggested')) {
        counts.unmatchedTransfers += 1
      }
      if (tx.pending) counts.pending += 1
      return counts
    },
    { aiPending: 0, uncategorized: 0, possibleRefunds: 0, unmatchedTransfers: 0, pending: 0 }
  )
}

export function formatShortDate(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00`)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
