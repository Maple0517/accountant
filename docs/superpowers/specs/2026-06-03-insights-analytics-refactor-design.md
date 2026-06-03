# Insights / Analytics Refactor Design

Date: 2026-06-03

## Summary

Refactor `/analytics` from a descriptive chart gallery into an actionable financial review surface.

The page should answer three questions in order:

1. Am I financially okay this period?
2. What changed, and why?
3. What should I do next?

The page remains a standalone sidebar destination only if it becomes a decision and review hub. If the final implementation cannot support actionable insights, the current charts should be merged into Dashboard or Budgets and `/analytics` should be removed from primary navigation.

## Current state

Current `/analytics` behavior:

- Period toggle: week, month, year.
- Currency toggle: USD, CNY.
- Summary cards:
  - total spending
  - biggest category
  - peak spending day
  - categories used
- Charts:
  - category ranking
  - daily spending trend
  - category share
  - income vs spending
- Top categories list.

Current data source:

- `src/app/api/analytics/route.ts`
- `src/modules/analytics/analytics.service.ts`
- `src/modules/analytics/analytics.types.ts`

Current data shape is useful but too shallow:

- total spending
- total income
- category totals
- monthly totals
- daily totals

The page currently describes what happened but does not explain whether it matters or create an action path.

## Product goal

Make Insights feel like a monthly financial review, not a generic analytics page.

The page should surface:

- financial health verdict
- budget risk
- unusual spending
- meaningful changes versus a comparison period
- review work that needs attention
- direct links into Transactions and Budgets

## Non-goals

- Do not build forecasting based on external market data.
- Do not add AI-generated narrative copy in the first version.
- Do not create a separate reporting/export product yet.
- Do not change transaction semantics.
- Do not change budget calculation semantics.
- Do not mix currencies into one converted total unless a conversion system is explicitly added later.

## Recommended information architecture

### 1. Financial verdict hero

The first screen should show one prominent verdict card.

Content:

- status: healthy, watch, or danger
- period spending
- period income
- net cash flow
- budget usage
- projected month-end budget usage when monthly data is available
- primary risk sentence

Example copy:

- "Watch this month: spending is 18% higher than last month and Dining is already over budget."
- "Healthy this month: spending is on track and net cash flow is positive."

The hero should be conclusion-first. Numeric details are supporting evidence, not the headline.

### 2. Needs attention

This is the most important actionable section.

Cards should be ranked by severity:

1. over-budget categories
2. projected over-budget categories
3. unusually high categories or merchants
4. review queue items
5. uncategorized or AI-pending transactions
6. suspicious duplicate or recurring merchant changes when data is available

Each item must include an action:

- View transactions
- Review now
- Adjust budget
- Set budget
- Mark reviewed

Actions should link to existing surfaces instead of creating a new workflow inside Insights.

### 3. What changed

Replace generic charts with change drivers.

Show:

- spending delta versus previous equivalent period
- income delta versus previous equivalent period
- top category increases
- top category decreases
- top merchant increases when merchant data is available

This section should explain why the period feels different.

### 4. Budget impact

Connect Insights to Budgets.

Show category groups:

- Over budget
- At risk
- On track
- No budget but meaningful spend

Each row should include:

- category
- current spend
- budget
- remaining amount
- percent used
- projected month-end amount when monthly projection is possible
- CTA to view related transactions or edit budget

### 5. Explore

Charts remain available but lower priority.

Keep only charts that support exploration:

- daily spending trend
- category ranking
- income vs spending

Demote or remove category share donut. It is visually common but low-value for decision-making.

## UX principles

### Prioritize conclusions over charts

The user should not have to inspect a chart to find the problem. The page should state the problem first, then let the user drill down.

### Make every insight actionable

If a card cannot answer "what can I do with this?", it should be removed or moved to Explore.

### Use severity and ranking

The page should not present all cards with equal visual weight. Risk and unresolved work should appear before nice-to-know metrics.

### Preserve trust in accounting semantics

Insights must use the same transaction and budget semantics already used by Dashboard and Budgets:

- ignore deleted transactions
- ignore report-hidden transactions
- ignore split parents
- use budget-effective dates
- respect budget-excluded categories
- preserve refund, income, transfer, and split treatment semantics through existing helpers

### Avoid fake intelligence

Do not use vague labels like "smart insight" unless the calculation is clear. Prefer concrete copy:

- "Dining is over budget by $146"
- "Groceries increased $82 versus last month"
- "8 transactions need review"

## Proposed data model

Extend `AnalyticsData` into a richer review model.

Suggested shape:

```ts
type AnalyticsReviewData = {
  period: {
    kind: 'week' | 'month' | 'year'
    startDate: string
    endDate: string
    comparisonStartDate: string
    comparisonEndDate: string
  }
  currencyCode: string
  verdict: {
    status: 'healthy' | 'watch' | 'danger'
    headline: string
    reasons: string[]
  }
  totals: {
    spending: number
    income: number
    net: number
    spendingDelta: number
    incomeDelta: number
    netDelta: number
  }
  attentionItems: AttentionItem[]
  changeDrivers: {
    categories: ChangeDriver[]
    merchants: ChangeDriver[]
  }
  budgetImpact: BudgetImpactSummary
  explore: {
    byDay: Array<{ date: string; total: number }>
    byCategory: Array<CategoryTotal>
    byMonth: Array<{ month: string; spending: number; income: number }>
  }
}
```

This does not require all fields to ship at once. Version 1 can keep the current chart fields under `explore` and add attention, comparison, and budget impact progressively.

## Component design

Suggested components:

- `AnalyticsPage`
  - route state, data loading, shell layout
- `InsightsVerdictCard`
  - top-level financial health conclusion
- `NeedsAttentionPanel`
  - ranked actionable cards
- `ChangeDriversPanel`
  - period-over-period category and merchant deltas
- `BudgetImpactPanel`
  - budget risk summary and category rows
- `AnalyticsExploreCharts`
  - downgraded chart section
- `InsightActionLink`
  - shared action links into Transactions and Budgets

Keep calculations in services, not components. Components should render already-ranked and already-labeled data.

## Backend design

Refactor `getAnalyticsSummary` into layered helpers:

- load current period transactions
- load comparison period transactions
- aggregate transaction semantics
- aggregate categories
- aggregate merchants
- aggregate daily and monthly trends
- load monthly budget summary when period is month
- derive verdict
- derive attention items
- derive change drivers

The main API can remain `/api/analytics`, but the returned payload should become review-oriented.

## Links and filters

Insights actions should link into existing pages with query params.

Examples:

- `/transactions?category=...&from=...&to=...`
- `/transactions?review=needed`
- `/transactions?status=ai-pending`
- `/budgets?month=...&category=...`

If the destination pages do not yet support a filter, implement the filter there as part of the relevant phase.

## Empty, loading, and error states

### Empty

If there are no transactions:

- show a setup-focused empty state
- explain that insights need transactions
- link to bank connection or transaction import path if available

### Loading

Use skeleton sections matching the final layout:

- verdict skeleton
- attention list skeleton
- chart skeleton only below the fold

### Error

Show a clear error:

- "Insights could not load. Try refreshing."
- keep existing navigation available
- do not show misleading zero values

## Implementation phases

### Phase 1: Reframe and restructure

- Replace current KPI grid with verdict hero.
- Move charts into an Explore section.
- Remove low-value "categories used" and category share prominence.
- Keep existing API shape where possible.

### Phase 2: Add comparison

- Load previous equivalent period.
- Add total deltas.
- Add category deltas.
- Show "What changed" section.

### Phase 3: Add budget impact

- Integrate monthly budget summary for month period.
- Show over-budget, at-risk, on-track, and no-budget meaningful-spend categories.
- Add links to Budgets and filtered Transactions.

### Phase 4: Add review and anomaly attention

- Add review queue summary.
- Add AI-pending or uncategorized transaction counts when reliable.
- Add merchant deltas.
- Add duplicate or recurring change detection only if supported by stable transaction fields.

### Phase 5: Polish and verify

- Split components.
- Add targeted tests for analytics service helpers.
- Verify Dashboard consumers still work if shared types change.
- Verify mobile layout and empty/error states.

## Testing strategy

### Unit tests

Test service helper behavior for:

- period boundaries
- previous period boundaries
- hidden/deleted/split-parent exclusion
- budget-excluded categories
- refund and income semantics through existing helpers
- positive and negative category deltas
- verdict severity rules

### Integration checks

Run:

- `npm run lint`
- `npm run typecheck`
- focused tests for analytics and budget services if available

### Browser checks

Verify:

- default monthly view
- week view
- year view
- USD view
- CNY view
- no-data state
- API error state
- mobile layout
- action links navigate to the correct filtered page

## Risks

- Changing `AnalyticsData` may break Dashboard cards that consume current analytics fields.
- Budget impact must not invent budget semantics separate from `getMonthlySummary`.
- Comparison periods need precise date boundaries; week, month, and year should behave differently.
- Multi-currency data should not be mixed unless conversion is explicitly implemented.
- Too many attention cards can make the page feel noisy; cap the list and rank by severity.

## Success criteria

The refactor is successful when:

- the first screen gives a clear financial verdict
- at least one section is directly actionable when there is meaningful data
- budget risk is visible without visiting Budgets first
- the user can jump from an insight to the relevant transactions
- charts are supportive, not the core product
- Dashboard remains stable
- accounting semantics remain consistent with Transactions and Budgets

