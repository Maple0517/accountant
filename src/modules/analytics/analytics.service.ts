import type { SupabaseClient } from '@supabase/supabase-js'
import type { MonthlyBudgetSummary } from '@/modules/budget/budget.types'
import { DEFAULT_CATEGORIES } from '@/lib/categories'
import { normalizeCurrencyCode } from '@/lib/money/currency'
import {
  getBudgetDate,
  getBudgetSemanticAmounts,
} from '@/lib/transactions/effective'
import type {
  AnalyticsAttentionItem,
  AnalyticsBudgetImpact,
  AnalyticsBudgetImpactItem,
  AnalyticsCategoryTotal,
  AnalyticsChangeDriver,
  AnalyticsData,
  AnalyticsTotals,
  AnalyticsVerdict,
  AnalyticsPeriod,
  AnalyticsPeriodWindow,
} from './analytics.types'

type AnalyticsSummaryOptions = {
  now?: Date
  budgetSummary?: MonthlyBudgetSummary | null
}

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
  merchant_name?: string | null
  pending?: boolean | null
  category_id?: string | null
  budget_effective_date?: string | null
  effective_date?: string | null
  deleted_at?: string | null
  is_hidden_from_reports?: boolean | null
  split_role?: string | null
  treatment?: string | null
  refund_source?: string | null
  categories?: AnalyticsCategoryRelation | AnalyticsCategoryRelation[] | null
}

type AnalyticsBucket = 'current' | 'comparison' | 'outside'

type MutableCategoryTotal = AnalyticsCategoryTotal & { id: string }

export function parseAnalyticsPeriod(value: string | null): AnalyticsPeriod {
  if (value === 'week' || value === 'year') {
    return value
  }

  return 'month'
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date)
  copy.setMonth(copy.getMonth() + months)
  return copy
}

function addYears(date: Date, years: number): Date {
  const copy = new Date(date)
  copy.setFullYear(copy.getFullYear() + years)
  return copy
}

export function getAnalyticsPeriodWindow(period: AnalyticsPeriod, now = new Date()): AnalyticsPeriodWindow {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endExclusive = addDays(todayStart, 1)

  if (period === 'week') {
    const start = addDays(endExclusive, -7)
    const comparisonEnd = start
    const comparisonStart = addDays(comparisonEnd, -7)
    return {
      period,
      startDate: toDateString(start),
      endDate: toDateString(endExclusive),
      comparisonStartDate: toDateString(comparisonStart),
      comparisonEndDate: toDateString(comparisonEnd),
    }
  }

  if (period === 'year') {
    const start = new Date(todayStart.getFullYear(), 0, 1)
    const comparisonStart = addYears(start, -1)
    const comparisonEnd = addYears(endExclusive, -1)
    return {
      period,
      startDate: toDateString(start),
      endDate: toDateString(endExclusive),
      comparisonStartDate: toDateString(comparisonStart),
      comparisonEndDate: toDateString(comparisonEnd),
    }
  }

  const start = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1)
  const comparisonStart = addMonths(start, -1)
  const comparisonEnd = addMonths(endExclusive, -1)
  return {
    period,
    startDate: toDateString(start),
    endDate: toDateString(endExclusive),
    comparisonStartDate: toDateString(comparisonStart),
    comparisonEndDate: toDateString(comparisonEnd),
  }
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

function transactionsHref(params: Record<string, string>) {
  const query = new URLSearchParams(params)
  return `/transactions?${query.toString()}`
}

function getBucket(date: string, periodWindow: AnalyticsPeriodWindow, shouldBucketByWindow: boolean): AnalyticsBucket {
  if (!shouldBucketByWindow) return 'current'
  if (date >= periodWindow.startDate && date < periodWindow.endDate) return 'current'
  if (date >= periodWindow.comparisonStartDate && date < periodWindow.comparisonEndDate) return 'comparison'
  return 'outside'
}

function incrementCategory(
  categoryMap: Map<string, MutableCategoryTotal>,
  tx: AnalyticsTransactionRow,
  amount: number
) {
  if (amount === 0) return

  const cat = normalizeCategoryDisplay(tx.categories)
  const catKey = tx.category_id || cat.name
  const existing = categoryMap.get(catKey) || {
    id: catKey,
    name: cat.name,
    name_zh: cat.name_zh,
    icon: cat.icon,
    color: cat.color,
    total: 0,
  }
  existing.total += amount
  categoryMap.set(catKey, existing)
}

function buildCategoryChangeDrivers(
  currentCategoryMap: Map<string, MutableCategoryTotal>,
  comparisonCategoryMap: Map<string, MutableCategoryTotal>,
  periodWindow: AnalyticsPeriodWindow
): AnalyticsChangeDriver[] {
  const ids = new Set([...currentCategoryMap.keys(), ...comparisonCategoryMap.keys()])

  return Array.from(ids)
    .map((id) => {
      const current = currentCategoryMap.get(id)
      const previous = comparisonCategoryMap.get(id)
      const source = current || previous
      return {
        id,
        label: source?.name || 'Other',
        labelZh: source?.name_zh ?? null,
        icon: source?.icon ?? null,
        color: source?.color ?? null,
        current: current?.total || 0,
        previous: previous?.total || 0,
        delta: (current?.total || 0) - (previous?.total || 0),
        href: transactionsHref({
          category: id,
          dateFrom: periodWindow.startDate,
          dateTo: periodWindow.endDate,
        }),
      }
    })
    .filter((driver) => driver.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}



function buildBudgetImpact(
  budgetSummary: MonthlyBudgetSummary | null | undefined,
  periodWindow: AnalyticsPeriodWindow,
  selectedCurrency: string
): AnalyticsBudgetImpact | null {
  if (!budgetSummary || normalizeCurrencyCode(budgetSummary.currencyCode) !== selectedCurrency) return null

  const toItem = (category: MonthlyBudgetSummary['categories'][number]): AnalyticsBudgetImpactItem => {
    const params = {
      category: category.categoryId,
      dateFrom: periodWindow.startDate,
      dateTo: periodWindow.endDate,
    }
    return {
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      categoryNameZh: category.categoryNameZh,
      status:
        category.status === 'over'
          ? 'over'
          : category.status === 'near'
            ? 'at_risk'
            : category.status === 'no_budget'
              ? 'no_budget'
              : 'on_track',
      actualSpend: category.actualSpend,
      baseBudget: category.baseBudget,
      remaining: category.remaining,
      percentUsed: category.percentUsed,
      projectedSpend: null,
      transactionsHref: transactionsHref(params),
      budgetHref: `/budgets?month=${encodeURIComponent(budgetSummary.month)}&category=${encodeURIComponent(category.categoryId)}`,
    }
  }

  const items = budgetSummary.categories.map(toItem)
  return {
    month: budgetSummary.month,
    currencyCode: budgetSummary.currencyCode,
    groups: {
      over: items.filter((item) => item.status === 'over'),
      atRisk: items.filter((item) => item.status === 'at_risk'),
      onTrack: items.filter((item) => item.status === 'on_track'),
      noBudget: items.filter((item) => item.status === 'no_budget' && item.actualSpend > 0),
    },
  }
}

function buildBudgetAttentionItems(budgetImpact: AnalyticsBudgetImpact | null): AnalyticsAttentionItem[] {
  if (!budgetImpact) return []

  const overItems = budgetImpact.groups.over.slice(0, 3).map((item) => ({
    id: `over-budget-${item.categoryId}`,
    kind: 'over_budget' as const,
    severity: 'danger' as const,
    titleKey: 'analytics.attention.overBudgetTitle',
    bodyKey: 'analytics.attention.overBudgetBody',
    amount: Math.abs(item.remaining),
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    categoryNameZh: item.categoryNameZh,
    href: item.budgetHref,
    actionTarget: 'budgets' as const,
  }))

  const atRiskItems = budgetImpact.groups.atRisk.slice(0, 3).map((item) => ({
    id: `at-risk-budget-${item.categoryId}`,
    kind: 'at_risk_budget' as const,
    severity: 'watch' as const,
    titleKey: 'analytics.attention.atRiskBudgetTitle',
    bodyKey: 'analytics.attention.atRiskBudgetBody',
    amount: item.remaining,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    categoryNameZh: item.categoryNameZh,
    href: item.budgetHref,
    actionTarget: 'budgets' as const,
  }))

  return [...overItems, ...atRiskItems]
}

function buildCategoryAttentionItems(drivers: AnalyticsChangeDriver[]): AnalyticsAttentionItem[] {
  return drivers
    .filter((driver) => driver.previous > 0 && driver.delta > Math.max(50, driver.previous * 0.25))
    .slice(0, 3)
    .map((driver) => ({
      id: `unusual-category-${driver.id}`,
      kind: 'unusual_category',
      severity: 'watch',
      titleKey: 'analytics.attention.unusualCategoryTitle',
      bodyKey: 'analytics.attention.unusualCategoryBody',
      amount: driver.delta,
      categoryId: driver.id,
      categoryName: driver.label,
      categoryNameZh: driver.labelZh,
      href: driver.href,
      actionTarget: 'transactions',
    }))
}

function buildVerdict(totals: AnalyticsTotals, attentionItems: AnalyticsAttentionItem[]): AnalyticsVerdict {
  if (attentionItems.some((item) => item.severity === 'danger')) {
    return {
      status: 'danger',
      headlineKey: 'analytics.verdict.dangerAttention',
      reasonKeys: ['analytics.verdict.reasonNeedsAction'],
    }
  }

  if (totals.previousSpending > 0 && totals.spending > totals.previousSpending * 1.25) {
    return {
      status: 'watch',
      headlineKey: 'analytics.verdict.watchSpendingUp',
      reasonKeys: ['analytics.verdict.reasonSpendingIncreased'],
      primaryAmount: totals.spendingDelta,
    }
  }

  if (totals.net < 0) {
    return {
      status: 'watch',
      headlineKey: 'analytics.verdict.watchNegativeNet',
      reasonKeys: ['analytics.verdict.reasonNegativeNet'],
      primaryAmount: Math.abs(totals.net),
    }
  }

  return {
    status: 'healthy',
    headlineKey: 'analytics.verdict.healthy',
    reasonKeys: ['analytics.verdict.reasonOnTrack'],
  }
}

export async function getAnalyticsSummary(
  supabase: SupabaseClient,
  userId: string,
  period: AnalyticsPeriod,
  currencyCode = 'USD',
  options: AnalyticsSummaryOptions = {}
): Promise<AnalyticsData> {
  const periodWindow = getAnalyticsPeriodWindow(period, options.now)
  const selectedCurrency = normalizeCurrencyCode(currencyCode)
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, iso_currency_code, date, merchant_name, pending, category_id, budget_effective_date, effective_date, deleted_at, is_hidden_from_reports, split_role, treatment, refund_source, categories!transactions_category_id_fkey ( name, name_zh, icon, color, is_excluded_from_budget )')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .eq('is_hidden_from_reports', false)
    .neq('split_role', 'parent')
    .gte('effective_date', periodWindow.comparisonStartDate)
    .lt('effective_date', periodWindow.endDate)
    .order('effective_date', { ascending: true })

  if (error) {
    throw new Error(`Failed to load analytics transactions: ${error.message}`)
  }

  let totalSpending = 0
  let totalIncome = 0
  let previousTotalSpending = 0
  let previousTotalIncome = 0
  const availableCurrencies = new Set<string>()
  const currentCategoryMap = new Map<string, MutableCategoryTotal>()
  const comparisonCategoryMap = new Map<string, MutableCategoryTotal>()
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
    const bucketDate = tx.effective_date || tx.date
    const bucket = getBucket(bucketDate, periodWindow, Boolean(options.now))

    if (bucket === 'outside') {
      continue
    }

    if (bucket === 'comparison') {
      previousTotalSpending += semanticAmounts.netSpending
      previousTotalIncome += semanticAmounts.income
      incrementCategory(comparisonCategoryMap, tx, semanticAmounts.categoryNetSpend)
      continue
    }

    totalSpending += semanticAmounts.netSpending
    totalIncome += semanticAmounts.income
    incrementCategory(currentCategoryMap, tx, semanticAmounts.categoryNetSpend)

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

  const net = totalIncome - totalSpending
  const previousNet = previousTotalIncome - previousTotalSpending
  const totals = {
    spending: totalSpending,
    income: totalIncome,
    net,
    previousSpending: previousTotalSpending,
    previousIncome: previousTotalIncome,
    previousNet,
    spendingDelta: totalSpending - previousTotalSpending,
    incomeDelta: totalIncome - previousTotalIncome,
    netDelta: net - previousNet,
  }
  const changeDrivers = buildCategoryChangeDrivers(
    currentCategoryMap,
    comparisonCategoryMap,
    periodWindow
  )
  const budgetImpact = buildBudgetImpact(options.budgetSummary, periodWindow, selectedCurrency)
  const attentionItems = [
    ...buildBudgetAttentionItems(budgetImpact),
    ...buildCategoryAttentionItems(changeDrivers),
  ]
  const verdict = buildVerdict(totals, attentionItems)

  return {
    totalSpending,
    totalIncome,
    currencyCode: selectedCurrency,
    availableCurrencies: Array.from(availableCurrencies),
    categorySpendingTotal: Array.from(currentCategoryMap.values()).reduce(
      (sum, category) => sum + Math.max(0, category.total),
      0
    ),
    byCategory: Array.from(currentCategoryMap.values())
      .sort((a, b) => b.total - a.total)
      .map(({ id: _id, ...category }) => category),
    byMonth: Array.from(monthMap.entries()).map(([month, d]) => ({
      month,
      ...d,
    })),
    byDay: Array.from(dayMap.entries()).map(([date, total]) => ({
      date,
      total,
    })),
    periodWindow,
    totals,
    verdict,
    attentionItems,
    changeDrivers: {
      categories: changeDrivers,
      merchants: [],
    },
    budgetImpact,
  }
}
