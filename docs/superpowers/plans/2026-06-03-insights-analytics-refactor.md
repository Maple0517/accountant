# Insights Analytics Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/analytics` into an actionable financial review surface with verdict, attention items, change drivers, budget impact, and downgraded exploratory charts.

**Architecture:** Keep `/api/analytics` as the public endpoint and keep the legacy chart fields compatible for Dashboard consumers. Move new decision logic into pure analytics service helpers so UI components render already-ranked data. Implement incrementally: contract and tests first, then service aggregation, then page/component restructure, then navigation links and verification.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, SWR, Supabase JS, Chart.js via `react-chartjs-2`, Node test runner through `npm test`.

---

## File map

### Create

- `src/components/analytics/InsightsVerdictCard.tsx`
  - Renders top financial verdict and key supporting metrics.
- `src/components/analytics/NeedsAttentionPanel.tsx`
  - Renders ranked actionable attention cards.
- `src/components/analytics/ChangeDriversPanel.tsx`
  - Renders period-over-period category and merchant deltas.
- `src/components/analytics/BudgetImpactPanel.tsx`
  - Renders budget risk groups and links to budgets/transactions.
- `src/components/analytics/AnalyticsExploreSection.tsx`
  - Wraps existing charts as lower-priority exploration.

### Modify

- `src/modules/analytics/analytics.types.ts`
  - Extend `AnalyticsData` with backward-compatible review fields.
- `src/modules/analytics/analytics.service.ts`
  - Add period windows, comparison aggregation, verdict, attention items, change drivers, and optional budget impact derivation.
- `src/app/api/analytics/route.ts`
  - Load budget summary for monthly views and pass it into analytics service options.
- `src/app/(dashboard)/analytics/page.tsx`
  - Replace KPI grid and chart-first layout with the new review layout.
- `src/components/analytics/AnalyticsCharts.tsx`
  - Keep chart rendering, but make it safe for empty explore data.
- `src/app/globals.css`
  - Add focused layout styles for verdict, attention, change drivers, budget impact, and Explore.
- `src/i18n/client.tsx`
  - Add copy for verdicts, attention items, deltas, budget impact, and Explore.
- `test/analytics-service.test.ts`
  - Add service tests for new analytics review behavior and adjust existing Supabase mocks for comparison-period queries.

### Reuse

- `src/modules/budget/budget.service.ts`
  - Reuse `getMonthlySummary`; do not invent separate budget semantics.
- `src/modules/budget/budget.types.ts`
  - Reuse `MonthlyBudgetSummary` and `CategoryBudgetSummary`.
- `src/lib/transactions/effective.ts`
  - Continue using `getBudgetDate` and `getBudgetSemanticAmounts`.
- `src/app/(dashboard)/transactions/page.tsx`
  - Existing query params already support `category`, `dateFrom`, and `dateTo` through `buildTransactionsQueryParams`.

---

## Task 1: Extend analytics contract without breaking Dashboard

**Files:**

- Modify: `src/modules/analytics/analytics.types.ts`
- Test: `test/analytics-service.test.ts`

- [ ] **Step 1: Add review-oriented types**

Replace `src/modules/analytics/analytics.types.ts` with this shape, preserving existing fields:

```ts
export type AnalyticsPeriod = 'week' | 'month' | 'year'

export type AnalyticsHealthStatus = 'healthy' | 'watch' | 'danger'

export type AnalyticsCategoryTotal = {
  id?: string | null
  name: string
  name_zh?: string | null
  icon: string
  color: string
  total: number
}

export type AnalyticsPeriodWindow = {
  period: AnalyticsPeriod
  startDate: string
  endDate: string
  comparisonStartDate: string
  comparisonEndDate: string
}

export type AnalyticsTotals = {
  spending: number
  income: number
  net: number
  previousSpending: number
  previousIncome: number
  previousNet: number
  spendingDelta: number
  incomeDelta: number
  netDelta: number
}

export type AnalyticsVerdict = {
  status: AnalyticsHealthStatus
  headlineKey: string
  reasonKeys: string[]
  primaryAmount?: number
}

export type AnalyticsAttentionKind =
  | 'over_budget'
  | 'at_risk_budget'
  | 'unusual_category'
  | 'review_queue'
  | 'uncategorized'
  | 'ai_pending'

export type AnalyticsActionTarget = 'transactions' | 'budgets'

export type AnalyticsAttentionItem = {
  id: string
  kind: AnalyticsAttentionKind
  severity: AnalyticsHealthStatus
  titleKey: string
  bodyKey: string
  amount?: number
  categoryId?: string | null
  categoryName?: string
  categoryNameZh?: string | null
  href: string
  actionTarget: AnalyticsActionTarget
}

export type AnalyticsChangeDriver = {
  id: string
  label: string
  labelZh?: string | null
  icon?: string | null
  color?: string | null
  current: number
  previous: number
  delta: number
  href: string
}

export type AnalyticsBudgetImpactItem = {
  categoryId: string
  categoryName: string
  categoryNameZh?: string | null
  status: 'over' | 'at_risk' | 'on_track' | 'no_budget'
  actualSpend: number
  baseBudget: number
  remaining: number
  percentUsed: number | null
  projectedSpend: number | null
  transactionsHref: string
  budgetHref: string
}

export type AnalyticsBudgetImpact = {
  month: string | null
  currencyCode: string
  groups: {
    over: AnalyticsBudgetImpactItem[]
    atRisk: AnalyticsBudgetImpactItem[]
    onTrack: AnalyticsBudgetImpactItem[]
    noBudget: AnalyticsBudgetImpactItem[]
  }
}

export type AnalyticsData = {
  totalSpending: number
  totalIncome: number
  currencyCode: string
  availableCurrencies?: string[]
  categorySpendingTotal: number
  byCategory: AnalyticsCategoryTotal[]
  byMonth: Array<{ month: string; spending: number; income: number }>
  byDay: Array<{ date: string; total: number }>
  periodWindow: AnalyticsPeriodWindow
  totals: AnalyticsTotals
  verdict: AnalyticsVerdict
  attentionItems: AnalyticsAttentionItem[]
  changeDrivers: {
    categories: AnalyticsChangeDriver[]
    merchants: AnalyticsChangeDriver[]
  }
  budgetImpact: AnalyticsBudgetImpact | null
}
```

- [ ] **Step 2: Run typecheck to surface downstream assumptions**

Run:

```bash
npm run typecheck
```

Expected: Type errors are acceptable at this step if they point to components that still expect the old `AnalyticsCategoryTotal` shape. Do not commit this task until typecheck passes after Step 3.

- [ ] **Step 3: Fix direct category type assumptions**

If TypeScript reports `byCategory` object shape issues, update consumers to use the new `AnalyticsCategoryTotal` alias rather than inline object shapes.

Expected consumers:

- `src/components/analytics/AnalyticsCharts.tsx`
- `src/app/(dashboard)/analytics/page.tsx`
- `src/features/dashboard/SpendingTrendCard.tsx`

- [ ] **Step 4: Run narrow verification**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/analytics/analytics.types.ts src/components/analytics/AnalyticsCharts.tsx src/app/(dashboard)/analytics/page.tsx src/features/dashboard/SpendingTrendCard.tsx
git commit -m "refactor: extend analytics review contract"
```

---

## Task 2: Add period-window and pure aggregation helpers

**Files:**

- Modify: `src/modules/analytics/analytics.service.ts`
- Modify: `test/analytics-service.test.ts`

- [ ] **Step 1: Add failing tests for period windows and deltas**

Append these tests to `test/analytics-service.test.ts`:

```ts
test('getAnalyticsPeriodWindow builds month-to-date comparison windows', () => {
  const window = getAnalyticsPeriodWindow('month', new Date('2026-06-15T12:00:00'))

  assert.deepEqual(window, {
    period: 'month',
    startDate: '2026-06-01',
    endDate: '2026-06-16',
    comparisonStartDate: '2026-05-01',
    comparisonEndDate: '2026-05-16',
  })
})

test('getAnalyticsSummary includes period-over-period totals', async () => {
  const rows = [
    {
      amount: 100,
      iso_currency_code: 'USD',
      effective_date: '2026-06-04',
      date: '2026-06-04',
      treatment: 'spending',
      category_id: 'food',
      merchant_name: 'Whole Foods',
      categories: { name: 'Food', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: 70,
      iso_currency_code: 'USD',
      effective_date: '2026-05-04',
      date: '2026-05-04',
      treatment: 'spending',
      category_id: 'food',
      merchant_name: 'Whole Foods',
      categories: { name: 'Food', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: -200,
      iso_currency_code: 'USD',
      effective_date: '2026-06-05',
      date: '2026-06-05',
      treatment: 'income',
      category_id: 'income',
      merchant_name: 'Payroll',
      categories: { name: 'Income', icon: '💰', color: '#4caf50' },
    },
  ]
  const supabase = {
    from() {
      const chain = {
        select() {
          return chain
        },
        eq() {
          return chain
        },
        neq() {
          return chain
        },
        is() {
          return chain
        },
        gte() {
          return chain
        },
        lt() {
          return chain
        },
        order() {
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return chain
    },
  }

  const summary = await getAnalyticsSummary(supabase as never, 'user_1', 'month', 'USD', {
    now: new Date('2026-06-15T12:00:00'),
  })

  assert.equal(summary.totalSpending, 100)
  assert.equal(summary.totalIncome, 200)
  assert.deepEqual(summary.totals, {
    spending: 100,
    income: 200,
    net: 100,
    previousSpending: 70,
    previousIncome: 0,
    previousNet: -70,
    spendingDelta: 30,
    incomeDelta: 200,
    netDelta: 170,
  })
  assert.equal(summary.changeDrivers.categories[0].delta, 30)
})
```

Update the existing import:

```ts
import {
  getAnalyticsPeriodWindow,
  getAnalyticsSummary,
  parseAnalyticsPeriod,
} from '@/modules/analytics/analytics.service'
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- test/analytics-service.test.ts
```

Expected: FAIL because `getAnalyticsPeriodWindow` and the new optional `now` argument do not exist yet.

- [ ] **Step 3: Implement period window helper and service options**

In `src/modules/analytics/analytics.service.ts`, add:

```ts
type AnalyticsSummaryOptions = {
  now?: Date
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

export function getAnalyticsPeriodWindow(period: AnalyticsPeriod, now = new Date()) {
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
```

- [ ] **Step 4: Update query to load comparison through current period**

In `getAnalyticsSummary`, change the signature to:

```ts
export async function getAnalyticsSummary(
  supabase: SupabaseClient,
  userId: string,
  period: AnalyticsPeriod,
  currencyCode = 'USD',
  options: AnalyticsSummaryOptions = {}
): Promise<AnalyticsData> {
```

Replace `const dateFrom = getDateFrom(period)` with:

```ts
const periodWindow = getAnalyticsPeriodWindow(period, options.now)
```

Change the Supabase date filters to:

```ts
.gte('effective_date', periodWindow.comparisonStartDate)
.lt('effective_date', periodWindow.endDate)
```

Add `lt() { return chain }` to all Supabase chain mocks in `test/analytics-service.test.ts`.

- [ ] **Step 5: Split current and comparison aggregates**

Add a small local bucket helper inside `getAnalyticsSummary`:

```ts
type AnalyticsBucket = 'current' | 'comparison' | 'outside'

function getBucket(date: string): AnalyticsBucket {
  if (date >= periodWindow.startDate && date < periodWindow.endDate) return 'current'
  if (date >= periodWindow.comparisonStartDate && date < periodWindow.comparisonEndDate) return 'comparison'
  return 'outside'
}
```

Track current and comparison totals separately. Existing `totalSpending`, `totalIncome`, `byCategory`, `byMonth`, and `byDay` should use only the `current` bucket.

- [ ] **Step 6: Build `totals` and `changeDrivers.categories`**

Return:

```ts
const net = totalIncome - totalSpending
const previousNet = previousTotalIncome - previousTotalSpending

totals: {
  spending: totalSpending,
  income: totalIncome,
  net,
  previousSpending: previousTotalSpending,
  previousIncome: previousTotalIncome,
  previousNet,
  spendingDelta: totalSpending - previousTotalSpending,
  incomeDelta: totalIncome - previousTotalIncome,
  netDelta: net - previousNet,
},
changeDrivers: {
  categories: buildCategoryChangeDrivers(currentCategoryMap, comparisonCategoryMap, periodWindow),
  merchants: [],
},
```

Use stable transaction links:

```ts
function transactionsHref(params: Record<string, string>) {
  const query = new URLSearchParams(params)
  return `/transactions?${query.toString()}`
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- test/analytics-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/analytics/analytics.service.ts test/analytics-service.test.ts
git commit -m "feat: add analytics comparison aggregation"
```

---

## Task 3: Add verdict and attention items

**Files:**

- Modify: `src/modules/analytics/analytics.service.ts`
- Modify: `test/analytics-service.test.ts`

- [ ] **Step 1: Add failing verdict test**

Append:

```ts
test('getAnalyticsSummary marks watch when spending rises materially', async () => {
  const rows = [
    {
      amount: 160,
      iso_currency_code: 'USD',
      effective_date: '2026-06-03',
      date: '2026-06-03',
      treatment: 'spending',
      category_id: 'food',
      categories: { name: 'Food', icon: '🍔', color: '#ff9800' },
    },
    {
      amount: 100,
      iso_currency_code: 'USD',
      effective_date: '2026-05-03',
      date: '2026-05-03',
      treatment: 'spending',
      category_id: 'food',
      categories: { name: 'Food', icon: '🍔', color: '#ff9800' },
    },
  ]
  const supabase = makeAnalyticsSupabase(rows)

  const summary = await getAnalyticsSummary(supabase as never, 'user_1', 'month', 'USD', {
    now: new Date('2026-06-15T12:00:00'),
  })

  assert.equal(summary.verdict.status, 'watch')
  assert.equal(summary.verdict.headlineKey, 'analytics.verdict.watchSpendingUp')
  assert.equal(summary.attentionItems[0].kind, 'unusual_category')
})
```

If `makeAnalyticsSupabase` does not exist yet, extract the repeated mock into:

```ts
function makeAnalyticsSupabase(rows: unknown[]) {
  return {
    from() {
      const chain = {
        select() {
          return chain
        },
        eq() {
          return chain
        },
        neq() {
          return chain
        },
        is() {
          return chain
        },
        gte() {
          return chain
        },
        lt() {
          return chain
        },
        order() {
          return Promise.resolve({ data: rows, error: null })
        },
      }
      return chain
    },
  }
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- test/analytics-service.test.ts
```

Expected: FAIL because verdict/attention rules are still neutral.

- [ ] **Step 3: Implement verdict rules**

Add rules in service:

```ts
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
```

- [ ] **Step 4: Implement category attention from change drivers**

Create attention items from positive category deltas:

```ts
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
```

- [ ] **Step 5: Return attention and verdict**

Build attention items first, then pass them into `buildVerdict`.

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- test/analytics-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/analytics/analytics.service.ts test/analytics-service.test.ts
git commit -m "feat: derive analytics verdict and attention"
```

---

## Task 4: Add monthly budget impact

**Files:**

- Modify: `src/modules/analytics/analytics.service.ts`
- Modify: `src/app/api/analytics/route.ts`
- Modify: `test/analytics-service.test.ts`

- [ ] **Step 1: Add service option type for budget summary**

In `src/modules/analytics/analytics.service.ts`, import:

```ts
import type { MonthlyBudgetSummary } from '@/modules/budget/budget.types'
```

Extend options:

```ts
type AnalyticsSummaryOptions = {
  now?: Date
  budgetSummary?: MonthlyBudgetSummary | null
}
```

- [ ] **Step 2: Add failing budget impact test**

Append:

```ts
test('getAnalyticsSummary converts monthly budget summary into budget impact groups', async () => {
  const supabase = makeAnalyticsSupabase([])

  const summary = await getAnalyticsSummary(supabase as never, 'user_1', 'month', 'USD', {
    now: new Date('2026-06-15T12:00:00'),
    budgetSummary: {
      userId: 'user_1',
      month: '2026-06',
      currencyCode: 'USD',
      budgetingEnabled: true,
      totalBaseBudget: 500,
      totalActualSpend: 450,
      totalRemaining: 50,
      totalPercentUsed: 0.9,
      categories: [
        {
          categoryId: 'food',
          categoryName: 'Food',
          categoryNameZh: '餐饮美食',
          baseBudget: 100,
          actualSpend: 130,
          remaining: -30,
          percentUsed: 1.3,
          status: 'over',
        },
        {
          categoryId: 'shopping',
          categoryName: 'Shopping',
          baseBudget: 200,
          actualSpend: 170,
          remaining: 30,
          percentUsed: 0.85,
          status: 'near',
        },
      ],
    },
  })

  assert.equal(summary.budgetImpact?.groups.over[0].categoryId, 'food')
  assert.equal(summary.budgetImpact?.groups.atRisk[0].categoryId, 'shopping')
  assert.equal(summary.attentionItems[0].kind, 'over_budget')
  assert.equal(summary.verdict.status, 'danger')
})
```

- [ ] **Step 3: Implement budget impact mapper**

Add:

```ts
function buildBudgetImpact(
  budgetSummary: MonthlyBudgetSummary | null | undefined,
  periodWindow: AnalyticsPeriodWindow
): AnalyticsBudgetImpact | null {
  if (!budgetSummary) return null

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
```

- [ ] **Step 4: Add budget attention items**

Add:

```ts
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
```

- [ ] **Step 5: Wire API route to budget summary**

In `src/app/api/analytics/route.ts`, import:

```ts
import { getMonthlySummary } from '@/modules/budget/budget.service'
```

Before calling `getAnalyticsSummary`, compute:

```ts
const now = new Date()
const budgetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const budgetSummary =
  period === 'month'
    ? await getMonthlySummary(supabase, user.id, budgetMonth).catch((error) => {
        console.warn('Analytics budget impact unavailable:', error)
        return null
      })
    : null
```

Call:

```ts
const data = await getAnalyticsSummary(supabase, user.id, period, currencyCode, {
  now,
  budgetSummary,
})
```

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- test/analytics-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/analytics/analytics.service.ts src/app/api/analytics/route.ts test/analytics-service.test.ts
git commit -m "feat: add analytics budget impact"
```

---

## Task 5: Build the new Insights page shell

**Files:**

- Create: `src/components/analytics/InsightsVerdictCard.tsx`
- Create: `src/components/analytics/NeedsAttentionPanel.tsx`
- Create: `src/components/analytics/ChangeDriversPanel.tsx`
- Create: `src/components/analytics/BudgetImpactPanel.tsx`
- Create: `src/components/analytics/AnalyticsExploreSection.tsx`
- Modify: `src/app/(dashboard)/analytics/page.tsx`
- Modify: `src/i18n/client.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Create verdict card**

Create `src/components/analytics/InsightsVerdictCard.tsx`:

```tsx
'use client'

import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

export function InsightsVerdictCard({ data }: { data: AnalyticsData }) {
  const { t } = useI18n()
  const statusClass = `insights-verdict-card ${data.verdict.status}`

  return (
    <Card className={statusClass} padding="lg">
      <div className="insights-verdict-main">
        <span className="insights-kicker">{t('analytics.reviewVerdict')}</span>
        <h2>{t(data.verdict.headlineKey, { amount: data.verdict.primaryAmount ? formatCurrency(data.verdict.primaryAmount, data.currencyCode) : '' })}</h2>
        <p>
          {data.verdict.reasonKeys
            .map((key) => t(key))
            .filter(Boolean)
            .join(' ')}
        </p>
      </div>
      <div className="insights-verdict-metrics">
        <div>
          <span>{t('analytics.metricSpending')}</span>
          <strong>{formatCurrency(data.totals.spending, data.currencyCode)}</strong>
        </div>
        <div>
          <span>{t('analytics.metricIncome')}</span>
          <strong>{formatCurrency(data.totals.income, data.currencyCode)}</strong>
        </div>
        <div>
          <span>{t('analytics.metricNet')}</span>
          <strong>{formatCurrency(data.totals.net, data.currencyCode)}</strong>
        </div>
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: Create needs-attention panel**

Create `src/components/analytics/NeedsAttentionPanel.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

export function NeedsAttentionPanel({ data }: { data: AnalyticsData }) {
  const { categoryName, t } = useI18n()
  const items = data.attentionItems.slice(0, 6)

  return (
    <Card padding="none" className="insights-panel">
      <div className="card-header">
        <div>
          <h3>{t('analytics.needsAttention')}</h3>
          <p className="card-subtitle">{t('analytics.needsAttentionSubtitle')}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="insights-empty-row">{t('analytics.noAttentionItems')}</div>
      ) : (
        <div className="insights-attention-list">
          {items.map((item) => (
            <Link key={item.id} href={item.href} className={`insights-attention-item ${item.severity}`}>
              <div>
                <span className="insights-attention-title">
                  {t(item.titleKey, {
                    category: categoryName({
                      name: item.categoryName || 'Other',
                      name_zh: item.categoryNameZh,
                      icon: '',
                      color: '',
                      total: 0,
                    }),
                  })}
                </span>
                <p>
                  {t(item.bodyKey, {
                    amount: item.amount === undefined ? '' : formatCurrency(item.amount, data.currencyCode),
                  })}
                </p>
              </div>
              <span className="insights-action">{item.actionTarget === 'budgets' ? t('analytics.openBudget') : t('analytics.viewTransactions')}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 3: Create change drivers panel**

Create `src/components/analytics/ChangeDriversPanel.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsChangeDriver, AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

function DriverRow({ driver, currencyCode }: { driver: AnalyticsChangeDriver; currencyCode: string }) {
  const { locale } = useI18n()
  const label = locale === 'zh' && driver.labelZh ? driver.labelZh : driver.label
  const positive = driver.delta >= 0

  return (
    <Link href={driver.href} className="insights-driver-row">
      <div className="cat-info">
        {driver.icon && <span className="cat-icon">{driver.icon}</span>}
        <span className="cat-name">{label}</span>
      </div>
      <div className={positive ? 'delta-positive' : 'delta-negative'}>
        {positive ? '+' : ''}
        {formatCurrency(driver.delta, currencyCode)}
      </div>
    </Link>
  )
}

export function ChangeDriversPanel({ data }: { data: AnalyticsData }) {
  const { t } = useI18n()
  const drivers = data.changeDrivers.categories.slice(0, 5)

  return (
    <Card padding="none" className="insights-panel">
      <div className="card-header">
        <div>
          <h3>{t('analytics.whatChanged')}</h3>
          <p className="card-subtitle">{t('analytics.whatChangedSubtitle')}</p>
        </div>
      </div>
      {drivers.length === 0 ? (
        <div className="insights-empty-row">{t('analytics.noChangeDrivers')}</div>
      ) : (
        <div className="insights-driver-list">
          {drivers.map((driver) => (
            <DriverRow key={driver.id} driver={driver} currencyCode={data.currencyCode} />
          ))}
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 4: Create budget impact panel**

Create `src/components/analytics/BudgetImpactPanel.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsBudgetImpactItem, AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

function BudgetImpactRow({ item, currencyCode }: { item: AnalyticsBudgetImpactItem; currencyCode: string }) {
  const { locale, t } = useI18n()
  const name = locale === 'zh' && item.categoryNameZh ? item.categoryNameZh : item.categoryName

  return (
    <div className={`insights-budget-row ${item.status}`}>
      <Link href={item.transactionsHref} className="insights-budget-name">{name}</Link>
      <span>{formatCurrency(item.actualSpend, currencyCode)}</span>
      <span>{item.baseBudget > 0 ? formatCurrency(item.baseBudget, currencyCode) : t('budgets.notConfigured')}</span>
      <Link href={item.budgetHref} className="insights-action">{t('analytics.openBudget')}</Link>
    </div>
  )
}

export function BudgetImpactPanel({ data }: { data: AnalyticsData }) {
  const { t } = useI18n()
  const impact = data.budgetImpact

  if (!impact) {
    return (
      <Card padding="none" className="insights-panel">
        <div className="card-header">
          <div>
            <h3>{t('analytics.budgetImpact')}</h3>
            <p className="card-subtitle">{t('analytics.budgetImpactUnavailable')}</p>
          </div>
        </div>
      </Card>
    )
  }

  const visible = [
    ...impact.groups.over,
    ...impact.groups.atRisk,
    ...impact.groups.noBudget,
    ...impact.groups.onTrack.slice(0, 3),
  ]

  return (
    <Card padding="none" className="insights-panel insights-budget-panel">
      <div className="card-header">
        <div>
          <h3>{t('analytics.budgetImpact')}</h3>
          <p className="card-subtitle">{t('analytics.budgetImpactSubtitle')}</p>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="insights-empty-row">{t('analytics.noBudgetImpact')}</div>
      ) : (
        <div className="insights-budget-list">
          {visible.map((item) => (
            <BudgetImpactRow key={item.categoryId} item={item} currencyCode={impact.currencyCode} />
          ))}
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 5: Wrap charts as Explore**

Create `src/components/analytics/AnalyticsExploreSection.tsx`:

```tsx
'use client'

import { Card } from '@/components/ui/Card'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'
import AnalyticsCharts from './AnalyticsCharts'

export function AnalyticsExploreSection({ data }: { data: AnalyticsData }) {
  const { t } = useI18n()

  return (
    <section className="insights-explore-section">
      <div className="insights-section-heading">
        <h2>{t('analytics.explore')}</h2>
        <p>{t('analytics.exploreSubtitle')}</p>
      </div>
      {data.byDay.length === 0 && data.byCategory.length === 0 ? (
        <Card className="insights-empty-row">{t('analytics.noExploreData')}</Card>
      ) : (
        <AnalyticsCharts data={data} currencyCode={data.currencyCode} />
      )}
    </section>
  )
}
```

- [ ] **Step 6: Update page composition**

In `src/app/(dashboard)/analytics/page.tsx`, remove the four-card `insight-grid`, direct `AnalyticsCharts` usage, and `top-categories-card`.

Import:

```ts
import { AnalyticsExploreSection } from '@/components/analytics/AnalyticsExploreSection'
import { BudgetImpactPanel } from '@/components/analytics/BudgetImpactPanel'
import { ChangeDriversPanel } from '@/components/analytics/ChangeDriversPanel'
import { InsightsVerdictCard } from '@/components/analytics/InsightsVerdictCard'
import { NeedsAttentionPanel } from '@/components/analytics/NeedsAttentionPanel'
```

Render inside `{data && hasData && (...)}`:

```tsx
<>
  <InsightsVerdictCard data={data} />
  <div className="insights-primary-grid">
    <NeedsAttentionPanel data={data} />
    <ChangeDriversPanel data={data} />
  </div>
  <BudgetImpactPanel data={data} />
  <AnalyticsExploreSection data={data} />
</>
```

- [ ] **Step 7: Add i18n keys**

Add English and Chinese keys in `src/i18n/client.tsx`:

```ts
'analytics.reviewVerdict': 'Financial verdict',
'analytics.metricSpending': 'Spending',
'analytics.metricIncome': 'Income',
'analytics.metricNet': 'Net',
'analytics.verdict.healthy': 'This period looks healthy',
'analytics.verdict.watchSpendingUp': 'Spending is rising',
'analytics.verdict.watchNegativeNet': 'Net cash flow is negative',
'analytics.verdict.dangerAttention': 'Action needed this period',
'analytics.verdict.reasonOnTrack': 'No major budget or spending risk is visible.',
'analytics.verdict.reasonSpendingIncreased': 'Spending is meaningfully higher than the comparison period.',
'analytics.verdict.reasonNegativeNet': 'Spending is higher than income for this period.',
'analytics.verdict.reasonNeedsAction': 'One or more budget categories need attention.',
'analytics.needsAttention': 'Needs attention',
'analytics.needsAttentionSubtitle': 'Ranked items worth handling first.',
'analytics.noAttentionItems': 'No urgent items for this period.',
'analytics.attention.unusualCategoryTitle': ({ category } = {}) => `${category} increased`,
'analytics.attention.unusualCategoryBody': ({ amount } = {}) => `${amount} more than the comparison period.`,
'analytics.attention.overBudgetTitle': ({ category } = {}) => `${category} is over budget`,
'analytics.attention.overBudgetBody': ({ amount } = {}) => `Over by ${amount}.`,
'analytics.attention.atRiskBudgetTitle': ({ category } = {}) => `${category} is close to budget`,
'analytics.attention.atRiskBudgetBody': ({ amount } = {}) => `${amount} remaining.`,
'analytics.viewTransactions': 'View transactions',
'analytics.openBudget': 'Open budget',
'analytics.whatChanged': 'What changed',
'analytics.whatChangedSubtitle': 'Largest category changes versus the comparison period.',
'analytics.noChangeDrivers': 'No meaningful category changes yet.',
'analytics.budgetImpact': 'Budget impact',
'analytics.budgetImpactSubtitle': 'How this period is tracking against budgets.',
'analytics.budgetImpactUnavailable': 'Budget impact is available for monthly views.',
'analytics.noBudgetImpact': 'No budget risk is visible.',
'analytics.explore': 'Explore',
'analytics.exploreSubtitle': 'Charts for deeper inspection.',
'analytics.noExploreData': 'No chart data for this period.',
```

Add Chinese equivalents with direct, non-marketing copy.

- [ ] **Step 8: Add CSS**

Append to the Analytics section in `src/app/globals.css`:

```css
.insights-verdict-card { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(18rem, 0.9fr); gap: 1.25rem; border-color: rgba(255,255,255,0.08); }
.insights-verdict-card.healthy { background: linear-gradient(135deg, rgba(23,107,77,0.18), rgba(255,255,255,0.03)); }
.insights-verdict-card.watch { background: linear-gradient(135deg, rgba(245,165,36,0.18), rgba(255,255,255,0.03)); }
.insights-verdict-card.danger { background: linear-gradient(135deg, rgba(200,63,73,0.18), rgba(255,255,255,0.03)); }
.insights-verdict-main { display: flex; flex-direction: column; gap: 0.55rem; }
.insights-verdict-main h2 { max-width: 44rem; font-size: clamp(1.45rem, 2vw, 2.2rem); line-height: 1.05; letter-spacing: -0.04em; }
.insights-verdict-main p { max-width: 46rem; color: var(--text-secondary); line-height: 1.5; }
.insights-kicker { color: var(--text-secondary); font-size: 0.76rem; font-weight: 850; letter-spacing: 0.08em; text-transform: uppercase; }
.insights-verdict-metrics { display: grid; grid-template-columns: 1fr; gap: 0.65rem; }
.insights-verdict-metrics div { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.8rem; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: rgba(255,255,255,0.035); }
.insights-verdict-metrics span { color: var(--text-secondary); font-size: 0.8rem; }
.insights-verdict-metrics strong { font-family: var(--font-numeric); font-variant-numeric: var(--numeric-spacing); }
.insights-primary-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 1rem; }
.insights-panel { overflow: hidden; }
.insights-empty-row { padding: 1rem 1.25rem; color: var(--text-secondary); }
.insights-attention-list, .insights-driver-list, .insights-budget-list { display: flex; flex-direction: column; }
.insights-attention-item, .insights-driver-row, .insights-budget-row { display: grid; align-items: center; gap: 1rem; padding: 0.95rem 1.25rem; border-top: 1px solid var(--border-subtle); color: var(--text-primary); text-decoration: none; transition: background var(--transition-fast), transform var(--transition-fast); }
.insights-attention-item { grid-template-columns: minmax(0, 1fr) auto; }
.insights-attention-item:hover, .insights-driver-row:hover, .insights-budget-row:hover { background: rgba(255,255,255,0.035); }
.insights-attention-title { display: block; font-weight: 800; }
.insights-attention-item p { margin-top: 0.2rem; color: var(--text-secondary); font-size: 0.84rem; }
.insights-action { color: var(--accent); font-size: 0.78rem; font-weight: 850; white-space: nowrap; }
.insights-driver-row { grid-template-columns: minmax(0, 1fr) auto; }
.delta-positive { color: var(--danger); font-family: var(--font-numeric); font-weight: 850; }
.delta-negative { color: var(--success); font-family: var(--font-numeric); font-weight: 850; }
.insights-budget-row { grid-template-columns: minmax(0, 1fr) minmax(6rem, auto) minmax(6rem, auto) auto; }
.insights-budget-name { min-width: 0; overflow: hidden; color: var(--text-primary); font-weight: 800; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; }
.insights-section-heading { display: flex; flex-direction: column; gap: 0.2rem; margin-top: 0.5rem; }
.insights-section-heading h2 { font-size: 1rem; }
.insights-section-heading p { color: var(--text-secondary); font-size: 0.85rem; }
@media (max-width: 900px) {
  .insights-verdict-card, .insights-primary-grid { grid-template-columns: 1fr; }
  .insights-budget-row { grid-template-columns: 1fr; align-items: start; }
}
```

- [ ] **Step 9: Verify UI compile**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/analytics src/app/(dashboard)/analytics/page.tsx src/i18n/client.tsx src/app/globals.css
git commit -m "feat: rebuild insights review layout"
```

---

## Task 6: Polish chart safety and action links

**Files:**

- Modify: `src/components/analytics/AnalyticsCharts.tsx`
- Modify: `src/app/(dashboard)/transactions/page.tsx`
- Modify: `test/transactions-query.test.ts`

- [ ] **Step 1: Confirm existing transaction filters**

Verify that `src/app/(dashboard)/transactions/page.tsx` reads:

```ts
const initialCategory = searchParams.get('category') || 'all'
```

and query params include:

```ts
dateFrom: queryFilters.dateFrom,
dateTo: queryFilters.dateTo,
```

If these remain true, no transaction page filter work is required for category/date links.

- [ ] **Step 2: Make charts robust for empty categories**

In `AnalyticsCharts`, keep `positiveCategories` and ensure the category chart and donut receive empty arrays safely. If Chart.js displays a broken empty canvas, show a small empty card instead:

```tsx
if (data.byDay.length === 0 && positiveCategories.length === 0 && data.byMonth.length === 0) {
  return null
}
```

- [ ] **Step 3: Verify budget link behavior**

Open `/budgets?month=YYYY-MM&category=category_id` manually during browser verification. If Budgets does not focus category from URL, leave the link as month-only in this implementation:

```ts
budgetHref: `/budgets?month=${encodeURIComponent(budgetSummary.month)}`
```

This prevents promising a deep link the destination does not support.

- [ ] **Step 4: Verify**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/analytics/AnalyticsCharts.tsx src/modules/analytics/analytics.service.ts src/app/(dashboard)/transactions/page.tsx test/transactions-query.test.ts
git commit -m "fix: harden insights action links"
```

If `src/app/(dashboard)/transactions/page.tsx` and `test/transactions-query.test.ts` were not changed, omit them from `git add`.

---

## Task 7: Full verification

**Files:**

- No source changes unless a verification failure requires a fix.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- test/analytics-service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repo checks**

Run:

```bash
npm run lint
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Browser verification**

Start dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/analytics
```

Verify:

- monthly default loads
- week toggle loads
- year toggle loads
- USD toggle loads
- CNY toggle loads
- verdict hero appears above charts
- Needs attention appears before Explore
- What changed appears before Explore
- Budget impact appears in monthly view
- Explore charts are below the actionable sections
- mobile width does not overflow
- action links navigate to Transactions or Budgets

- [ ] **Step 5: Final commit if fixes were needed**

If verification required fixes:

```bash
git add <changed-files>
git commit -m "fix: verify insights analytics refactor"
```

If no fixes were needed, do not create an empty commit.

---

## Self-review checklist

- Spec coverage:
  - Verdict hero: Task 3 and Task 5.
  - Needs attention: Task 3, Task 4, and Task 5.
  - What changed: Task 2 and Task 5.
  - Budget impact: Task 4 and Task 5.
  - Explore section: Task 5 and Task 6.
  - Accounting semantics: Task 2 preserves existing semantic helpers; Task 4 reuses budget service.
  - Verification: Task 7.
- Placeholder scan:
  - No unresolved planning gaps.
  - Optional work is expressed as explicit branch behavior, not vague follow-up.
- Type consistency:
  - `AnalyticsData` keeps legacy chart fields.
  - New UI components consume the new review fields.
  - Dashboard remains compatible because existing fields stay present.

