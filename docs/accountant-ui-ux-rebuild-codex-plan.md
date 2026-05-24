# Accountant UI/UX Full Rebuild Plan for Codex

> Repo: `Maple0517/accountant`<br>
> Goal: rebuild Accountant from a generic dark dashboard into a polished AI financial workspace focused on transaction review, budget intelligence, and trustworthy personal finance insights.

---

## 0. Operating Rules for Codex

Before editing, read the current repo. Do not assume this plan is more accurate than the code.

Read first:

1. `AI_HANDOFF.md`
2. `README.md`
3. `docs/ARCHITECTURE.md`
4. `package.json`
5. `src/types/index.ts`
6. `src/app/(dashboard)/layout.tsx`
7. `src/app/globals.css`
8. `src/components/layout/Sidebar.tsx`
9. `src/components/layout/Header.tsx`
10. Dashboard pages under `src/app/(dashboard)/`
11. Existing API routes under `src/app/api/`
12. Budget logic under `src/modules/budget/`
13. Analytics logic under `src/modules/analytics/`

Hard constraints:

- Preserve existing business behavior unless this plan explicitly says otherwise.
- Do not break Supabase auth, Plaid sync, Notion sync, iOS Shortcut receipt capture, transaction semantics, refund handling, budget behavior, or AI classification queues.
- Do not casually change database schema.
- Do not remove transaction semantic fields such as refund, reimbursement, transfer, `budget_behavior`, `transfer_match_status`, pending status, AI tags, or linked transaction metadata.
- Do not introduce fake UI. If a search box, notification bell, sync status, or insight appears, it must either work or be clearly disabled/hidden.
- Prefer incremental commits/checkpoints. Run validation after each phase.

Validation commands:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If any command does not exist or fails because of pre-existing unrelated issues, document the reason in the final summary.

---

## 1. Product Direction

Current UI problem: it looks like a generic AI-generated admin dashboard. It has cards, charts, glassmorphism, and emoji icons, but the information hierarchy does not reflect the real value of the product.

New direction:

> Accountant should feel like an AI-powered money review cockpit: a place where users understand what happened, review uncertain transactions, fix budget-impacting semantics, and trust that refunds/transfers/credit-card payments are handled correctly.

Primary product pillars:

1. **Overview**: What is my current financial state?
2. **Review Inbox**: What needs my attention?
3. **Transactions**: What happened, and how is each transaction treated?
4. **Budgets**: Am I safe, close, or over budget?
5. **Insights**: Why did spending change?
6. **Accounts**: Are my connected accounts healthy and up to date?
7. **Integrations**: Is Plaid / Notion / iOS Shortcut configured correctly?

---

## 2. Target Information Architecture

Replace or evolve the current navigation into this structure:

```txt
Overview        -> /dashboard
Review          -> /review          optional but strongly recommended
Transactions    -> /transactions
Budgets         -> /budgets
Insights        -> /analytics
Accounts        -> /accounts
Integrations    -> /settings or /integrations
```

If creating `/review` is too large for the first pass, implement a prominent “Needs Review” section on Dashboard and a saved view/filter inside Transactions.

Navigation rules:

- Remove emoji nav icons. Use either simple inline SVG icons or install `lucide-react` if acceptable.
- Keep labels short and product-like.
- Active state should be obvious but not neon.
- Sidebar should support responsive behavior on mobile.

---

## 3. Visual Design Direction

Choose one consistent direction and apply it everywhere.

Preferred direction: **professional dark fintech UI**, not glassmorphism.

Design tokens:

```css
:root {
  --bg-app: #080a0f;
  --bg-surface: #10131a;
  --bg-surface-raised: #151923;
  --bg-muted: #1b2030;

  --border-subtle: #252a38;
  --border-strong: #343b4d;

  --text-primary: #f5f7fb;
  --text-secondary: #a3aab8;
  --text-muted: #687083;

  --accent: #7c5cff;
  --accent-soft: rgba(124, 92, 255, 0.14);

  --income: #20c997;
  --expense: #ff5c7a;
  --warning: #f5a524;
  --info: #4ea1ff;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.24);
  --shadow-md: 0 12px 32px rgba(0,0,0,0.28);
}
```

Rules:

- Reduce blur/glass effects. Use solid surfaces, borders, and clean elevation.
- Use accent color for primary actions and AI-specific UI only.
- Use red/green only for financial semantics.
- Use tabular numbers for amounts.
- Avoid excessive monospace. Use it only for numbers or IDs.
- Replace decorative placeholder charts with real data or remove them.
- Avoid huge low-value cards. Every card must answer a user question.

---

## 4. Component System Refactor

Create a small reusable UI layer. Do this before rewriting pages.

Target files:

```txt
src/components/ui/Button.tsx
src/components/ui/Card.tsx
src/components/ui/Input.tsx
src/components/ui/Select.tsx
src/components/ui/Badge.tsx
src/components/ui/Tabs.tsx
src/components/ui/MetricCard.tsx
src/components/ui/EmptyState.tsx
src/components/ui/Skeleton.tsx
src/components/ui/Drawer.tsx
src/components/ui/ProgressBar.tsx
src/components/ui/StatusDot.tsx
```

Expected behavior:

- Components should be lightweight and typed.
- Do not over-engineer a full design system.
- Use `className` passthrough.
- Prefer CSS classes over inline styles.
- Use semantic HTML.
- Ensure keyboard focus states are visible.

Example component APIs:

```tsx
<Card variant="default" padding="md">...</Card>
<Button variant="primary" size="sm">Save</Button>
<Badge tone="warning">Needs review</Badge>
<MetricCard label="Budget left" value="$421" tone="positive" helper="12 days remaining" />
<ProgressBar value={0.72} tone="warning" />
```

Refactor `src/app/globals.css`:

- Keep tokens, resets, typography, layout primitives, and shared utility classes.
- Remove page-specific duplicated CSS where possible.
- Do not keep large “Extracted from page.tsx” style blocks long-term.
- Move feature-specific CSS into component-level classes or clearly grouped sections.

---

## 5. Layout Refactor

Current issue: Header has fake global search and fake notification bell. Sidebar uses emoji icons and generic dashboard styling.

Create or refactor:

```txt
src/components/layout/AppShell.tsx
src/components/layout/Sidebar.tsx
src/components/layout/TopBar.tsx
src/components/layout/PageHeader.tsx
```

Requirements:

- Sidebar: clean nav, no emoji icons, visible active state.
- TopBar: only show working controls. Remove fake search and fake notification bell unless implemented.
- PageHeader: consistent title, subtitle, actions, period switchers.
- Mobile: sidebar collapses or becomes bottom nav / drawer.
- Main content max width should be intentional. Use wider layouts for transaction tables and analytics.

Acceptance criteria:

- Every dashboard page uses the same page shell.
- No duplicate page title in both Header and page body unless intentionally designed.
- No non-functional global UI remains visible.

---

## 6. Dashboard / Overview Rebuild

File likely involved:

```txt
src/app/(dashboard)/dashboard/page.tsx
src/app/api/dashboard/route.ts
```

Current issue:

- Spending Overview is placeholder bars.
- Budget Progress is a link prompt, not useful state.
- Recent transactions are okay but not enough.

New dashboard layout:

```txt
[Financial Snapshot]
  Net worth / Cash / Card debt / This month spending / Budget left

[Needs Review]
  AI pending / Uncategorized / Possible refunds / Unmatched transfers / Pending transactions

[Budget Health]
  Overall progress + top 3 risky categories

[Spending Trend]
  Real daily/monthly spending data, not placeholder bars

[Recent Activity]
  Recent transactions with semantic badges
```

Implementation details:

- Use existing `/api/dashboard` if sufficient.
- If missing data for review counts, add a focused API route or extend dashboard API carefully.
- Do not block the page on slow secondary data. Use SWR and skeletons.
- Remove hardcoded chart placeholder.
- Add empty states for users with no connected accounts / no transactions / no budgets.

Suggested components:

```txt
src/features/dashboard/FinancialSnapshot.tsx
src/features/dashboard/NeedsReviewCard.tsx
src/features/dashboard/BudgetHealthCard.tsx
src/features/dashboard/SpendingTrendCard.tsx
src/features/dashboard/RecentActivityCard.tsx
```

Acceptance criteria:

- Dashboard answers: “Am I okay?” and “What needs attention?”
- All charts/cards use real data or are hidden with useful empty states.
- No decorative fake controls.

---

## 7. Transactions Rebuild

Files likely involved:

```txt
src/app/(dashboard)/transactions/page.tsx
src/app/api/transactions/route.ts
src/app/api/transactions/[id]/category/route.ts
src/app/api/transactions/[id]/refund/route.ts
src/app/api/transactions/[id]/semantics/route.ts
```

Current issue:

- Transactions page contains too much state and UI in one file.
- Category popover also contains refund handling and budget treatment. This is confusing.
- AI queue controls are technically useful but feel like a debug/admin feature.

New transaction UX:

```txt
Top summary row:
  Showing X / Total Y / Needs review count / Pending count

Saved views:
  All | Needs Review | Uncategorized | AI Pending | Refunds | Transfers | Pending | Large

Filters:
  Search, Account, Category, Currency, Date range

Main list:
  Date group or category group
  Each row shows merchant, account, status badges, category, amount

Right drawer:
  Transaction detail
  Category editor
  AI classification status
  Budget treatment
  Refund / reimbursement matcher
  Transfer handling
  Raw metadata / debug collapsed
```

Refactor components:

```txt
src/features/transactions/TransactionsPageClient.tsx
src/features/transactions/TransactionFilters.tsx
src/features/transactions/TransactionSavedViews.tsx
src/features/transactions/TransactionGroup.tsx
src/features/transactions/TransactionRow.tsx
src/features/transactions/TransactionDrawer.tsx
src/features/transactions/CategoryPicker.tsx
src/features/transactions/BudgetTreatmentEditor.tsx
src/features/transactions/RefundMatcher.tsx
src/features/transactions/SimilarMerchantSuggestion.tsx
src/features/transactions/AiClassificationQueue.tsx
```

Important behavior to preserve:

- Pagination: currently page size is 50.
- Debounced search.
- Account/category/currency/date filters.
- Group by date/category.
- Category update.
- Apply category to similar transactions.
- Create category.
- AI classification queue.
- Refund metadata updates.
- Budget behavior updates.
- Transfer semantics.

UX changes:

- Clicking a row opens drawer.
- Category pill can still quick-open category picker, but refund/budget/transfer tools move to drawer.
- Show badges for:
  - AI Pending
  - AI Classified
  - Pending
  - Refund
  - Reimbursement
  - Transfer
  - Excluded
  - Counts as spending
  - Counts as income
  - Matched / Suggested / Unmatched
- Move “Queue AI Refresh” into a less visually dominant control, such as a toolbar secondary action or Review card action.

Acceptance criteria:

- Transaction page remains fast with hundreds of transactions.
- Opening/closing drawer does not refetch unnecessarily.
- Editing category/semantics updates local UI optimistically or with clear loading state.
- No business capability is lost.
- The UI makes transaction treatment understandable to a non-developer.

---

## 8. Optional New Review Page

If feasible, create:

```txt
src/app/(dashboard)/review/page.tsx
```

Purpose:

A focused inbox for items that need user confirmation.

Review item types:

- Uncategorized transaction
- AI pending / Plaid fallback category
- Low confidence AI classification if confidence exists
- Possible refund match
- Unmatched transfer
- Pending transaction older than expected
- Budget behavior ambiguous

Layout:

```txt
Review Inbox
  Summary counts
  Tabs by issue type
  Review card list
  Right drawer or inline actions
```

Actions:

- Accept AI category
- Change category
- Apply to similar merchants
- Mark as transfer
- Mark as refund/reimbursement
- Exclude from budget
- Count as spending/income

Acceptance criteria:

- Review page should not duplicate all Transactions functionality.
- It should be task-focused: decide, apply, move on.

---

## 9. Budgets Rebuild

Files likely involved:

```txt
src/app/(dashboard)/budgets/page.tsx
src/app/api/budget/monthly-summary/route.ts
src/app/api/budget/category-budget/route.ts
src/modules/budget/
```

Current issue:

- Works functionally but feels like a settings/config table.
- Many inline styles and manual hover DOM mutations.
- It shows over-budget state but does not guide action.

New budget layout:

```txt
Header:
  Month switcher

Budget Health:
  Total budget / spent / remaining / projected month-end
  Health state: Safe / Watch / Over

Category budget cards/rows:
  Category name + icon
  Budget
  Spent
  Remaining
  Progress
  Projected end-of-month if possible
  Actions: edit budget, view transactions, exclude/include

Suggestions:
  Categories without budget
  Use last 3-month average
```

Refactor components:

```txt
src/features/budgets/BudgetMonthSwitcher.tsx
src/features/budgets/BudgetHealthSummary.tsx
src/features/budgets/BudgetCategoryRow.tsx
src/features/budgets/BudgetEditPopover.tsx
src/features/budgets/BudgetSuggestions.tsx
```

Implementation notes:

- Remove inline styles where practical.
- Keep inline budget editing but make affordance obvious.
- Add an explicit edit button or hover action.
- Show empty budget states clearly.
- Keep current month navigation.

Acceptance criteria:

- User can instantly tell which categories are safe, near limit, or over.
- User can set/edit budgets without guessing that the amount is clickable.
- Budget page visually explains why remaining is negative.

---

## 10. Analytics / Insights Rebuild

Files likely involved:

```txt
src/app/(dashboard)/analytics/page.tsx
src/components/analytics/AnalyticsCharts.tsx
src/app/api/analytics/route.ts
src/modules/analytics/
```

Current issue:

- Page is chart-first, not insight-first.
- Doughnut/line/bar charts exist but do not explain behavior.
- Hardcoded chart colors and labels feel generic.

New structure:

```txt
Insight summary:
  This period vs previous period
  Biggest increase
  Top merchant
  Largest transaction
  Refund-adjusted spending if available

Charts:
  Category ranking bar chart
  Daily spending trend
  Merchant breakdown
  Income vs spending

Top categories table/list:
  Category, amount, percentage, change if available
```

Implementation notes:

- If previous-period comparison data is not available, do not fake it.
- Prefer readable bar/ranking charts over donut as primary visualization.
- Use category colors when available.
- Keep period switcher: Week / Month / Year.
- Use empty states if data is sparse.

Acceptance criteria:

- Analytics page starts with conclusions, then charts.
- No chart should be visually impressive but semantically useless.
- Period switching remains functional.

---

## 11. Accounts Rebuild

Files likely involved:

```txt
src/app/(dashboard)/accounts/page.tsx
src/components/accounts/AccountCard.tsx
src/components/plaid/PlaidLinkButton.tsx
```

Current issue:

- Account cards are large and decorative.
- Important account health and sync information is not prominent enough.

New account page:

```txt
Connected Accounts
  Overall sync health
  Last successful sync
  Reconnect warnings

Groups:
  Cash & Checking
  Credit Cards
  Manual / iOS Capture

Each account card:
  Institution
  Account name + mask
  Current balance
  Available balance
  Pending amount if known
  Last checked
  Sync/reconnect status
  Account type badge
```

Credit card-specific enhancements if data exists:

- Current balance
- Available credit
- Credit limit
- Utilization
- Payment due date if available

Acceptance criteria:

- User can tell whether Plaid data is fresh.
- User can tell which accounts need attention.
- Zero-balance accounts do not dominate the page visually.

---

## 12. Settings / Integrations Rebuild

Files likely involved:

```txt
src/app/(dashboard)/settings/page.tsx
src/lib/notion/
src/app/api/receipt/
```

Current issue:

- Settings exposes developer details too prominently.
- Notion token/database ID and localhost endpoint feel like debug UI.

New structure:

```txt
Profile
  Display name
  Default currency

Integrations
  Plaid
  Notion
  iOS Shortcut Capture

Advanced
  API endpoint
  Internal IDs
  Debug information
```

Notion card:

- Connected / Not connected status
- Last sync if available
- Force sync
- Change token/database
- Hide raw database ID by default

IOS Shortcut card:

- Setup guide
- Generate/revoke API key
- Copy endpoint
- Show full API key only once

Acceptance criteria:

- Main settings page feels user-facing.
- Technical IDs are hidden behind Advanced/Details.
- Existing Notion and API key behavior is preserved.

---

## 13. Data Fetching and Performance Rules

The user has previously complained that the web page feels slow. While rebuilding UI, do not make performance worse.

Rules:

- Avoid duplicate fetches.
- Use SWR consistently where appropriate.
- Avoid blocking entire pages on secondary data.
- Keep transaction pagination.
- Avoid rendering huge hidden popovers for every transaction row.
- Drawer should render only for selected transaction.
- Memoize expensive groupings and derived data.
- Use skeletons that match final layout.
- Avoid unnecessary client-side state duplication when SWR cache can be the source of truth.

Specific concern:

Transactions currently mixes manual `fetchTransactions` and SWR initial fetch. During refactor, simplify if possible, but preserve pagination and debounced filters.

Acceptance criteria:

- No excessive repeated requests on page load.
- Filtering/searching feels responsive.
- Transaction list remains usable with 300+ records.

---

## 14. Accessibility and Responsive Requirements

Minimum requirements:

- All buttons have accessible labels if icon-only.
- All inputs/selects have labels or `aria-label`.
- Drawer supports Escape to close.
- Focus states are visible.
- Color is not the only indicator of status.
- Amounts remain legible on dark background.
- Mobile layout does not require horizontal scrolling for common pages.
- Transaction rows stack cleanly on small screens.
- Charts have accessible labels or textual summaries.

---

## 15. Implementation Sequence

### Phase 1: Audit and Prep

- [ ] Read current repo files listed in section 0.
- [ ] Identify current component and CSS structure.
- [ ] Create a branch such as `ui-ux-rebuild`.
- [ ] Run baseline validation commands and record current status.

### Phase 2: Design Tokens and UI Components

- [ ] Refactor `globals.css` tokens.
- [ ] Add UI primitives under `src/components/ui/`.
- [ ] Replace repeated button/card/input styles gradually.
- [ ] Remove or quarantine duplicated page-specific CSS.

### Phase 3: App Shell

- [ ] Refactor sidebar.
- [ ] Refactor header/topbar.
- [ ] Remove fake search/notification controls unless implemented.
- [ ] Add consistent `PageHeader`.
- [ ] Verify all dashboard routes render correctly.

### Phase 4: Dashboard

- [ ] Replace placeholder spending chart with real data or remove.
- [ ] Add Financial Snapshot.
- [ ] Add Needs Review card.
- [ ] Add Budget Health card.
- [ ] Improve Recent Activity.
- [ ] Add proper empty/loading/error states.

### Phase 5: Transactions

- [ ] Extract transaction page into feature components.
- [ ] Add saved views / review filters.
- [ ] Create `TransactionDrawer`.
- [ ] Move refund and budget treatment controls from category popover into drawer.
- [ ] Preserve category editing and apply-to-similar behavior.
- [ ] Preserve AI queue behavior but improve placement.
- [ ] Validate pagination/search/filter/grouping.

### Phase 6: Budgets

- [ ] Extract budget components.
- [ ] Remove inline style-heavy rows.
- [ ] Make edit budget affordance explicit.
- [ ] Add health summary and category risk states.
- [ ] Preserve monthly summary API usage and PATCH behavior.

### Phase 7: Analytics

- [ ] Make page insight-first.
- [ ] Improve chart hierarchy.
- [ ] Use readable category ranking.
- [ ] Keep period toggle.
- [ ] Avoid fake comparisons if data is unavailable.

### Phase 8: Accounts and Settings

- [ ] Make Accounts focus on sync health and useful balance info.
- [ ] Rework Settings into Profile / Integrations / Advanced.
- [ ] Hide technical details by default.
- [ ] Preserve Notion sync and iOS Shortcut API key behavior.

### Phase 9: Polish and Validation

- [ ] Test desktop widths: 1440, 1280, 1024.
- [ ] Test mobile widths: 390, 430, 768.
- [ ] Test dark contrast and long merchant/account names.
- [ ] Test loading/empty/error states.
- [ ] Run validation commands.
- [ ] Produce final summary with changed files, known limitations, and follow-up recommendations.

---

## 16. Acceptance Criteria for the Whole Rebuild

The rebuild is successful if:

- The app no longer feels like a generic dashboard template.
- Dashboard clearly answers what happened and what needs attention.
- Transactions page is easier to use despite having complex semantics.
- Refund, transfer, and budget treatment controls are understandable.
- Budgets page helps users manage spending, not just edit numbers.
- Analytics page explains spending, not just displays charts.
- Settings feels like integrations management, not a debug panel.
- Existing API/data behavior remains intact.
- Typecheck, lint, tests, and build are either passing or failures are clearly documented.

---

## 17. Final Response Expected from Codex

When done, provide:

1. Summary of UI/UX changes.
2. List of changed files.
3. Any behavior preserved intentionally.
4. Any behavior changed intentionally.
5. Screenshots or route-by-route visual notes if possible.
6. Validation results for:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run build`
7. Known limitations and next recommended tasks.
