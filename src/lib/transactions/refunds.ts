import type { Transaction } from '@/types'

export function isRefundLikeAmount(amount: number) {
  // Accountant stores Plaid amounts as positive expenses and negative credits.
  return amount < 0
}

export function getBudgetDate(tx: Pick<Transaction, 'budget_effective_date' | 'date'>) {
  return tx.budget_effective_date || tx.date
}

export function formatMonthFromDate(date: string) {
  return date.slice(0, 7)
}
