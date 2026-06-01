import type { DashboardAccount, DashboardMonthTransaction } from './types'
import { isSameCurrency, normalizeCurrencyCode } from '@/lib/money/currency'
import { getBudgetSemanticAmounts } from '@/lib/transactions/effective'
import {
  AI_PENDING_TAG,
  PLAID_FALLBACK_TAG,
} from '@/lib/plaid/classification'
import { needsRefundReview, needsTransferReview } from '@/lib/transactions/review'

export function getMonthlySemanticAmounts(
  tx: Pick<
    DashboardMonthTransaction,
    | 'amount'
    | 'treatment'
    | 'refund_source'
    | 'categories'
  >
) {
  const category = Array.isArray(tx.categories) ? tx.categories[0] : tx.categories
  const semanticAmounts = getBudgetSemanticAmounts({
    amount: tx.amount,
    treatment: tx.treatment,
    refund_source: tx.refund_source,
    category_is_excluded_from_budget: category?.is_excluded_from_budget === true,
  })

  return {
    spending: semanticAmounts.netSpending,
    income: semanticAmounts.income,
  }
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
      if (tags.includes(AI_PENDING_TAG) || tags.includes(PLAID_FALLBACK_TAG)) {
        counts.aiPending += 1
      }
      if (!tx.category_id) counts.uncategorized += 1
      if (needsRefundReview(tx)) counts.possibleRefunds += 1
      if (needsTransferReview(tx)) {
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
