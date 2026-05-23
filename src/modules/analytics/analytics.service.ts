import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnalyticsData, AnalyticsPeriod } from './analytics.types'

type AnalyticsTransactionRow = {
  amount: number | string
  date: string
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
      return new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0]
    case 'month':
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split('T')[0]
  }
}

export function parseAnalyticsPeriod(value: string | null): AnalyticsPeriod {
  if (value === 'week' || value === 'year') {
    return value
  }

  return 'month'
}

export async function getAnalyticsSummary(
  supabase: SupabaseClient,
  userId: string,
  period: AnalyticsPeriod
): Promise<AnalyticsData> {
  const dateFrom = getDateFrom(period)
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, date, categories ( name, icon, color )')
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
    const amount = Number(tx.amount)

    if (amount > 0) {
      totalSpending += amount
    } else if (amount < 0) {
      totalIncome += Math.abs(amount)
    }

    if (amount > 0) {
      const cat = tx.categories
      const catName = cat?.name || 'Other'
      const existing = categoryMap.get(catName) || {
        name: catName,
        icon: cat?.icon || '📦',
        color: cat?.color || '#8888a0',
        total: 0,
      }
      existing.total += amount
      categoryMap.set(catName, existing)
    }

    const monthKey = tx.date.substring(0, 7)
    const monthData = monthMap.get(monthKey) || {
      spending: 0,
      income: 0,
    }
    if (amount > 0) monthData.spending += amount
    else if (amount < 0) monthData.income += Math.abs(amount)
    monthMap.set(monthKey, monthData)

    const dayData = dayMap.get(tx.date) || 0
    dayMap.set(tx.date, dayData + (amount > 0 ? amount : 0))
  }

  return {
    totalSpending,
    totalIncome,
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
