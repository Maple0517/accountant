import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_CATEGORIES } from '@/lib/categories'
import { normalizeCurrencyCode } from '@/lib/money/currency'
import type { AnalyticsData, AnalyticsPeriod } from './analytics.types'

type AnalyticsCategoryRelation = {
  name?: string | null
  name_zh?: string | null
  icon?: string | null
  color?: string | null
}

type AnalyticsTransactionRow = {
  amount: number | string
  iso_currency_code?: string | null
  date: string
  category_id?: string | null
  budget_effective_date?: string | null
  budget_behavior?: string | null
  transaction_kind?: string | null
  categories?: AnalyticsCategoryRelation | AnalyticsCategoryRelation[] | null
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

function normalizeCategoryDisplay(
  category: AnalyticsTransactionRow['categories']
) {
  const cat = Array.isArray(category) ? category[0] : category
  const canonical = DEFAULT_CATEGORIES.find((defaultCategory) =>
    defaultCategory.name === cat?.name ||
    defaultCategory.name_zh === cat?.name ||
    defaultCategory.name === cat?.name_zh ||
    defaultCategory.name_zh === cat?.name_zh
  )

  return {
    name: canonical?.name || cat?.name || cat?.name_zh || 'Other',
    name_zh: canonical?.name_zh || cat?.name_zh || null,
    icon: cat?.icon || canonical?.icon || '📦',
    color: cat?.color || canonical?.color || '#8888a0',
  }
}

export async function getAnalyticsSummary(
  supabase: SupabaseClient,
  userId: string,
  period: AnalyticsPeriod,
  currencyCode = 'USD'
): Promise<AnalyticsData> {
  const dateFrom = getDateFrom(period)
  const selectedCurrency = normalizeCurrencyCode(currencyCode)
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, iso_currency_code, date, category_id, budget_effective_date, budget_behavior, transaction_kind, categories!transactions_category_id_fkey ( name, name_zh, icon, color )')
    .eq('user_id', userId)
    .gte('date', dateFrom)
    .order('date', { ascending: true })

  if (error) {
    throw new Error(`Failed to load analytics transactions: ${error.message}`)
  }

  let totalSpending = 0
  let totalIncome = 0
  const availableCurrencies = new Set<string>()
  const categoryMap = new Map<
    string,
    { name: string; name_zh?: string | null; icon: string; color: string; total: number }
  >()
  const monthMap = new Map<string, { spending: number; income: number }>()
  const dayMap = new Map<string, number>()

  for (const tx of (data || []) as AnalyticsTransactionRow[]) {
    const transactionCurrency = normalizeCurrencyCode(tx.iso_currency_code)
    availableCurrencies.add(transactionCurrency)

    if (transactionCurrency !== selectedCurrency) {
      continue
    }

    const semanticAmounts = getSemanticAmounts(tx)

    totalSpending += semanticAmounts.spending
    totalIncome += semanticAmounts.income

    if (semanticAmounts.categorySpend !== 0) {
      const rawCat = tx.categories
      const cat = normalizeCategoryDisplay(rawCat)
      const catKey = tx.category_id || cat.name
      const existing = categoryMap.get(catKey) || {
        name: cat.name,
        name_zh: cat.name_zh,
        icon: cat.icon,
        color: cat.color,
        total: 0,
      }
      existing.total += semanticAmounts.categorySpend
      categoryMap.set(catKey, existing)
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
    currencyCode: selectedCurrency,
    availableCurrencies: Array.from(availableCurrencies),
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
