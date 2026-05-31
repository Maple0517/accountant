import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_CATEGORIES } from '@/lib/categories'
import { normalizeCurrencyCode } from '@/lib/money/currency'
import {
  getBudgetDate,
  getBudgetSemanticAmounts,
} from '@/lib/transactions/effective'
import type { AnalyticsData, AnalyticsPeriod } from './analytics.types'

type AnalyticsCategoryRelation = {
  name?: string | null
  name_zh?: string | null
  icon?: string | null
  color?: string | null
  is_excluded_from_budget?: boolean | null
}

type AnalyticsTransactionRow = {
  amount: number | string
  iso_currency_code?: string | null
  date: string
  category_id?: string | null
  budget_effective_date?: string | null
  effective_date?: string | null
  deleted_at?: string | null
  is_hidden_from_reports?: boolean | null
  split_role?: string | null
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

function isExcludedBudgetCategory(
  category: AnalyticsTransactionRow['categories']
) {
  const cat = Array.isArray(category) ? category[0] : category
  return cat?.is_excluded_from_budget === true
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
    .select('amount, iso_currency_code, date, category_id, budget_effective_date, effective_date, deleted_at, is_hidden_from_reports, split_role, budget_behavior, treatment, refund_source, transaction_kind, categories!transactions_category_id_fkey ( name, name_zh, icon, color, is_excluded_from_budget )')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .eq('is_hidden_from_reports', false)
    .neq('split_role', 'parent')
    .gte('effective_date', dateFrom)
    .order('effective_date', { ascending: true })

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

    const semanticAmounts = getBudgetSemanticAmounts({
      ...tx,
      category_is_excluded_from_budget: isExcludedBudgetCategory(tx.categories),
    })

    totalSpending += semanticAmounts.netSpending
    totalIncome += semanticAmounts.income

    if (semanticAmounts.categoryNetSpend !== 0) {
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
      existing.total += semanticAmounts.categoryNetSpend
      categoryMap.set(catKey, existing)
    }

    const budgetDate = getBudgetDate(tx)
    const monthKey = budgetDate.substring(0, 7)
    if (semanticAmounts.netSpending !== 0 || semanticAmounts.income !== 0) {
      const monthData = monthMap.get(monthKey) || {
        spending: 0,
        income: 0,
      }
      monthData.spending += semanticAmounts.netSpending
      monthData.income += semanticAmounts.income
      monthMap.set(monthKey, monthData)
    }

    if (semanticAmounts.netSpending !== 0) {
      const dayData = dayMap.get(budgetDate) || 0
      dayMap.set(budgetDate, dayData + semanticAmounts.netSpending)
    }
  }

  return {
    totalSpending,
    totalIncome,
    currencyCode: selectedCurrency,
    availableCurrencies: Array.from(availableCurrencies),
    categorySpendingTotal: Array.from(categoryMap.values()).reduce(
      (sum, category) => sum + Math.max(0, category.total),
      0
    ),
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
