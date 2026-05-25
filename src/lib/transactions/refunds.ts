export { getBudgetDate } from '@/lib/transactions/effective'

export function isRefundLikeAmount(amount: number) {
  // Accountant stores Plaid amounts as positive expenses and negative credits.
  return amount < 0
}

export function formatMonthFromDate(date: string) {
  return date.slice(0, 7)
}
