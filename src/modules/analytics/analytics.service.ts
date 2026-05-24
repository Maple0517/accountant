import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnalyticsData, AnalyticsPeriod } from './analytics.types'

type AnalyticsTransactionRow = {
  amount: number | string
  date: string
  budget_effective_date?: string | null
  budget_behavior?: string | null
  transaction_kind?: string | null
  categories?: {
    name?: string | null
    icon?: string | null
    color?: string | null
  } | null
}

function getDateFrom(period: AnalyticsPeriod): string {
  const now = new Date()

  switch (period) {
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0]
    case 'year':
      return `${now.getFullYear()}-01-01`
    case 'month':
    default:
      return getLocalMonthStart(now)
  }
}

export function parseAnalyticsPeriod(value: string | null): AnalyticsPeriod {
  if (value === 'week' || value === 'year') {
    return value
  }

  return 'month'
}


function getLocalMonthStart(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function getBudgetDate(row: Pick<AnalyticsTransactionRow, 'budget_effective_date' | 'date'>) {
  return row.budget_effective_date || row.date
}

function getSemanticAmounts(tx: AnalyticsTransactionRow) {
  const amount = Number(tx.amount)

  if (!Number.isFinite(amount)) {
    return { spending: 0, income: 0, categorySpend: 0 }
  }

  if (tx.budget_behavior === 'exclude_as_transfer' || tx.budget_behavior === 'exclude_manual') {
    return { spending: 0, income: 0, categorySpend: 0 }
  }

  if (tx.budget_behavior === 'count_as_income') {
    return { spending: 0, income: Math.abs(amount), categorySpend: 0 }
  }

  if (tx.budget_behavior === 'count_as_spending') {
    return { spending: amount, income: 0, categorySpend: amount }
  }

  if (amount > 0) return { spending: amount, income: 0, categorySpend: amount }
  if (amount < 0) return { spending: 0, income: Math.abs(amount), categorySpend: 0 }
  return { spending: 0, income: 0, categorySpend: 0 }
}

export async function getAnalyticsSummary(
  supabase: SupabaseClient,
  userId: string,
  period: AnalyticsPeriod,
  currencyCode = 'USD'
): Promise<AnalyticsData> {
  const dateFrom = getDateFrom(period)
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, date, budget_effective_date, budget_behavior, transaction_kind, categories!transactions_category_id_fkey ( name, icon, color )')
    .eq('user_id', userId)
    .gte('date', dateFrom)
    .order('date', { ascending: true })

  if (error) {
    throw new Error(`Failed to load analytics transactions: ${error.message}`)
  }

  let totalSpending = 0
  let totalIncome = 0
  const categoryMap = new Map<
    string,
    { name: string; icon: string; color: string; total: number }
  >()
  const monthMap = new Map<string, { spending: number; income: number }>()
  const dayMap = new Map<string, number>()

  for (const tx of (data || []) as AnalyticsTransactionRow[]) {
    const semanticAmounts = getSemanticAmounts(tx)

    totalSpending += semanticAmounts.spending
    totalIncome += semanticAmounts.income

    if (semanticAmounts.categorySpend !== 0) {
      const cat = tx.categories
      const catName = cat?.name || 'Other'
      const existing = categoryMap.get(catName) || {
        name: catName,
        icon: cat?.icon || '📦',
        color: cat?.color || '#8888a0',
        total: 0,
      }
      existing.total += semanticAmounts.categorySpend
      categoryMap.set(catName, existing)
    }

    const budgetDate = getBudgetDate(tx)
    const monthKey = budgetDate.substring(0, 7)
    const monthData = monthMap.get(monthKey) || {
      spending: 0,
      income: 0,
    }
    monthData.spending += semanticAmounts.spending
    monthData.income += semanticAmounts.income
    monthMap.set(monthKey, monthData)

    const dayData = dayMap.get(budgetDate) || 0
    dayMap.set(budgetDate, dayData + semanticAmounts.spending)
  }

  return {
    totalSpending,
    totalIncome,
    currencyCode,
    byCategory: Array.from(categoryMap.values()).sort(
      (a, b) => b.total - a.total
    ),
    byMonth: Array.from(monthMap.entries()).map(([month, d]) => ({
      month,
      ...d,
    })),
    byDay: Array.from(dayMap.entries()).map(([date, total]) => ({
      date,
      total,
    })),
  }
}
