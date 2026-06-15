# Budget UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the budget page into a calmer ledger-style UI with clearer unbudgeted-category semantics and fewer horizontal lines.

**Architecture:** Keep the current client page, SWR data loading, inline edit flow, and details drawer. Change only presentation helpers, markup grouping, i18n copy, and CSS classes in the existing global styling system.

**Tech Stack:** Next.js 16 App Router, React 19, SWR, TypeScript, global CSS, existing UI components.

---

## File structure

- Modify `src/app/(dashboard)/budgets/page.tsx`: compute summary metrics, render one ledger card, adjust `BudgetCategoryRow` presentation copy and classes.
- Modify `src/i18n/namespaces/budgets.ts`: add English and Chinese labels for the summary strip and unbudgeted row states.
- Modify `src/app/globals.css`: add ledger, summary, reduced-line row styling and responsive behavior.
- Modify `docs/superpowers/specs/2026-06-15-budget-ui-refresh-design.md`: committed design context only.
- Modify `docs/superpowers/plans/2026-06-15-budget-ui-refresh.md`: committed execution plan only.

### Task 1: Add budget copy keys

**Files:**
- Modify: `src/i18n/namespaces/budgets.ts`

- [ ] **Step 1: Add keys in the English namespace**

Add these keys near the existing budget labels:

```ts
  'budgets.configuredCount': ({ count } = {}) => `${count} categories configured`,
  'budgets.unbudgetedSpend': 'Unbudgeted spend',
  'budgets.categoriesNeedReview': ({ count } = {}) => `${count} categories need review`,
  'budgets.categoryBudgets': 'Category budgets',
  'budgets.categoryBudgetsSubtitle': 'Configured categories first. Unbudgeted spend stays visible without pretending the budget is $0.',
  'budgets.spentBudgetShort': ({ spent, budget } = {}) => `${spent} / ${budget}`,
  'budgets.unbudgetedAmount': ({ amount } = {}) => `${amount} unbudgeted`,
  'budgets.noMonthlyLimit': 'No monthly limit set',
  'budgets.noBudgetSet': 'No budget set',
  'budgets.readyWhenNeeded': 'Ready when needed',
```

- [ ] **Step 2: Add matching keys in the Chinese namespace**

Add these keys near the existing Chinese budget labels:

```ts
  'budgets.configuredCount': ({ count } = {}) => `已配置 ${count} 个分类`,
  'budgets.unbudgetedSpend': '未预算支出',
  'budgets.categoriesNeedReview': ({ count } = {}) => `${count} 个分类需处理`,
  'budgets.categoryBudgets': '分类预算',
  'budgets.categoryBudgetsSubtitle': '已配置分类优先显示；未预算支出单独标记，不再伪装成 $0 预算。',
  'budgets.spentBudgetShort': ({ spent, budget } = {}) => `${spent} / ${budget}`,
  'budgets.unbudgetedAmount': ({ amount } = {}) => `${amount} 未预算`,
  'budgets.noMonthlyLimit': '未设置月度上限',
  'budgets.noBudgetSet': '未设置预算',
  'budgets.readyWhenNeeded': '需要时再设置',
```

- [ ] **Step 3: Run a narrow typecheck after i18n edit**

Run: `npm run typecheck`

Expected: exit 0, or unrelated existing errors documented before continuing.

### Task 2: Restructure budget page markup

**Files:**
- Modify: `src/app/(dashboard)/budgets/page.tsx`

- [ ] **Step 1: Add helper metrics after `hasBudget`**

Add:

```ts
  const configuredCount = visibleCategories.filter((category) => category.baseBudget > 0).length
  const unbudgetedCategoriesWithSpend = visibleCategories.filter(
    (category) => category.baseBudget <= 0 && category.actualSpend > 0
  )
  const unbudgetedSpend = unbudgetedCategoriesWithSpend.reduce(
    (total, category) => total + category.actualSpend,
    0
  )
```

- [ ] **Step 2: Replace the prominent health card with a metric strip**

Replace the current `<Card className="budget-health-card budget-health-card-prominent" ...>` block with:

```tsx
          <div className="budget-summary-strip" aria-label={t('budgets.monthlyProgress')}>
            <Card className="budget-summary-tile" padding="md">
              <span className="metric-label">{t('budgets.totalBudget')}</span>
              <span className="metric-value">
                {formatCurrency(summary.totalBaseBudget, summary.currencyCode)}
              </span>
              <span className="budget-summary-copy">
                {t('budgets.configuredCount', { count: configuredCount })}
              </span>
            </Card>
            <Card className="budget-summary-tile" padding="md">
              <span className="metric-label">{t('budgets.spent')}</span>
              <span className="metric-value">
                {formatCurrency(summary.totalActualSpend, summary.currencyCode)}
              </span>
              <span className="budget-summary-copy">
                {summary.totalPercentUsed === null
                  ? t('budgets.noPlanYet')
                  : t('budgets.used', { percent: Math.round(summary.totalPercentUsed * 100) })}
              </span>
            </Card>
            <Card className="budget-summary-tile" padding="md">
              <span className="metric-label">{t('budgets.remaining')}</span>
              <span
                className="metric-value"
                style={{ color: summary.totalRemaining < 0 ? 'var(--expense)' : 'var(--income)' }}
              >
                {formatCurrency(summary.totalRemaining, summary.currencyCode)}
              </span>
              <span className="budget-summary-copy">{t(health.copyKey)}</span>
            </Card>
            <Card className="budget-summary-tile budget-summary-tile-warm" padding="md">
              <span className="metric-label">{t('budgets.unbudgetedSpend')}</span>
              <span className="metric-value">
                {formatCurrency(unbudgetedSpend, summary.currencyCode)}
              </span>
              <span className="budget-summary-copy">
                {t('budgets.categoriesNeedReview', { count: unbudgetedCategoriesWithSpend.length })}
              </span>
            </Card>
          </div>
```

- [ ] **Step 3: Replace per-group cards with one ledger card**

Replace the `sectionOrder.map((group) => { ... <Card key={group} ...> ... </Card> })` rendering with one `<Card className="budget-ledger-card" padding="lg">` that maps groups inside it:

```tsx
          <Card className="budget-ledger-card" padding="lg">
            <div className="budget-ledger-header">
              <div>
                <h3>{t('budgets.categoryBudgets')}</h3>
                <p className="card-subtitle">{t('budgets.categoryBudgetsSubtitle')}</p>
              </div>
              <Badge tone={health.tone}>{t(health.labelKey)}</Badge>
            </div>
            <div className="budget-ledger-columns" aria-hidden="true">
              <span>{t('budgets.category')}</span>
              <span>{t('budgets.budget')}</span>
              <span>{t('budgets.progress')}</span>
              <span>{t('budgets.status')}</span>
            </div>
            <div className="budget-ledger-groups">
              {sectionOrder.map((group) => {
                const items = groupedCategories[group]
                const groupLabel = getGroupLabel(group, t)

                if (items.length === 0) return null

                return (
                  <section key={group} className="budget-ledger-group" aria-label={groupLabel}>
                    <div className="budget-ledger-group-label">
                      <span>{groupLabel}</span>
                      <span className="badge badge-muted">{items.length}</span>
                    </div>
                    <div className="budget-risk-list budget-ledger-list">
                      {items
                        .slice()
                        .sort((a, b) => (b.percentUsed ?? -1) - (a.percentUsed ?? -1))
                        .map((category) => {
                          const displayCategoryName = categoryName({
                            name: category.categoryName,
                            name_zh: category.categoryNameZh,
                          })
                          const tone = getStatusTone(category.status)

                          return (
                            <BudgetCategoryRow
                              key={category.categoryId}
                              cat={category}
                              isEditing={editingId === category.categoryId}
                              editValue={editValue}
                              saving={saving}
                              tone={tone}
                              hasBudget={Boolean(hasBudget)}
                              displayCategoryName={displayCategoryName}
                              currencyCode={summary.currencyCode}
                              onStartEdit={() => startEdit(category)}
                              onEditChange={(v) => setEditValue(v)}
                              onEditKeyDown={(e) => handleEditKeyDown(e, category.categoryId)}
                              onCommit={() => commitEdit(category.categoryId)}
                              onCancelEdit={cancelEdit}
                              onOpenDetails={() => openCategoryDetail(category.categoryId)}
                              onAmountAria={t('budgets.amountAria')}
                              t={t}
                            />
                          )
                        })}
                    </div>
                  </section>
                )
              })}
            </div>
          </Card>
```

- [ ] **Step 4: Update row copy and classes**

In `BudgetCategoryRow`, compute:

```ts
  const isConfigured = cat.baseBudget > 0
  const hasUnbudgetedSpend = !isConfigured && cat.actualSpend > 0
  const rowClassName = [
    'budget-risk-row budget-category-row budget-ledger-row',
    isConfigured ? 'budget-ledger-row-configured' : 'budget-ledger-row-unconfigured',
    hasUnbudgetedSpend ? 'budget-ledger-row-needs-budget' : '',
  ].filter(Boolean).join(' ')
```

Use `className={rowClassName}` on the row.

Replace the spend text with configured/unbudgeted-aware copy:

```tsx
        <span className="budget-category-spend">
          {isConfigured
            ? t('budgets.spentBudgetShort', {
                spent: formatCurrency(cat.actualSpend, currencyCode),
                budget: formatCurrency(cat.baseBudget, currencyCode),
              })
            : hasUnbudgetedSpend
              ? t('budgets.unbudgetedAmount', { amount: formatCurrency(cat.actualSpend, currencyCode) })
              : t('budgets.noBudgetSet')}
        </span>
```

Replace the status badge contents with:

```tsx
          {showRemaining
            ? t('dashboard.left', { amount: formatCurrency(cat.remaining, currencyCode) })
            : hasUnbudgetedSpend
              ? t('budgets.noMonthlyLimit')
              : t('budgets.readyWhenNeeded')}
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: exit 0.

### Task 3: Add reduced-line ledger CSS

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add summary strip CSS near the Budgets section**

Add:

```css
.budget-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.85rem;
}
.budget-summary-tile {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.35rem;
}
.budget-summary-tile .metric-value {
  font-size: clamp(1.25rem, 2vw, 1.8rem);
  line-height: 1.05;
}
.budget-summary-copy {
  color: var(--text-secondary);
  font-size: 0.82rem;
  line-height: 1.35;
}
.budget-summary-tile-warm {
  border-color: rgba(245, 165, 36, 0.24);
  background: rgba(245, 165, 36, 0.08);
}
```

- [ ] **Step 2: Add ledger CSS and reduce horizontal-line density**

Add:

```css
.budget-ledger-card { overflow: hidden; }
.budget-ledger-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.budget-ledger-header h3 {
  margin: 0 0 0.25rem;
  font-size: 1.05rem;
  font-weight: 780;
  letter-spacing: -0.02em;
}
.budget-ledger-columns {
  display: grid;
  grid-template-columns: minmax(13rem, 1fr) minmax(10rem, 0.44fr) minmax(10rem, 0.72fr) minmax(9rem, 0.42fr);
  gap: 1rem;
  padding: 0 0 0.65rem;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.budget-ledger-groups {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding-top: 0.9rem;
}
.budget-ledger-group { display: flex; flex-direction: column; gap: 0.55rem; }
.budget-ledger-group-label {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 760;
}
.budget-ledger-list { gap: 0.35rem; }
.budget-ledger-row {
  grid-template-columns: minmax(13rem, 1fr) minmax(10rem, 0.44fr) minmax(10rem, 0.72fr) minmax(9rem, 0.42fr);
  gap: 1rem;
  padding: 0.72rem 0.8rem;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  transition: background var(--transition-fast), transform var(--transition-fast);
}
.budget-ledger-row:hover { background: var(--bg-hover); transform: translateY(-1px); }
.budget-ledger-row-needs-budget {
  background: rgba(245, 165, 36, 0.08);
  box-shadow: inset 3px 0 0 rgba(245, 165, 36, 0.75);
}
.budget-ledger-row-needs-budget:hover { background: rgba(245, 165, 36, 0.12); }
.budget-ledger-row-unconfigured:not(.budget-ledger-row-needs-budget) .budget-category-button,
.budget-ledger-row-unconfigured:not(.budget-ledger-row-needs-budget) .budget-category-spend {
  color: var(--text-secondary);
}
.budget-ledger-row .progress { max-width: 18rem; margin-left: auto; }
.budget-ledger-row .budget-category-progress-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.budget-ledger-row .budget-category-progress-cell > div { width: min(100%, 18rem); }
.budget-ledger-row-needs-budget .budget-edit-button {
  border-color: rgba(245, 165, 36, 0.42);
  background: rgba(245, 165, 36, 0.16);
}
```

- [ ] **Step 3: Update responsive budget CSS**

Add inside `@media (max-width: 1024px)`:

```css
  .budget-summary-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .budget-ledger-columns { display: none; }
  .budget-ledger-row { grid-template-columns: minmax(12rem, 1fr) minmax(9rem, auto); }
```

Add inside `@media (max-width: 640px)`:

```css
  .budget-summary-strip { grid-template-columns: 1fr; }
  .budget-ledger-header { flex-direction: column; }
  .budget-ledger-row { grid-template-columns: 1fr; align-items: stretch; }
  .budget-ledger-row .budget-category-progress-cell { align-items: flex-start; text-align: left; }
  .budget-ledger-row .progress { margin-left: 0; }
```

- [ ] **Step 4: Run lint**

Run: `npm run lint`

Expected: exit 0.

### Task 4: Final verification and commit

**Files:**
- Review all changed files.

- [ ] **Step 1: Re-read changed files**

Run:

```bash
git diff -- src/app/(dashboard)/budgets/page.tsx src/app/globals.css src/i18n/namespaces/budgets.ts docs/superpowers/specs/2026-06-15-budget-ui-refresh-design.md docs/superpowers/plans/2026-06-15-budget-ui-refresh.md
```

Expected: diff is limited to planned UI/spec/plan changes.

- [ ] **Step 2: Run final checks**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both exit 0.

- [ ] **Step 3: Commit focused change**

Run:

```bash
git add src/app/(dashboard)/budgets/page.tsx src/app/globals.css src/i18n/namespaces/budgets.ts docs/superpowers/specs/2026-06-15-budget-ui-refresh-design.md docs/superpowers/plans/2026-06-15-budget-ui-refresh.md
git commit -m "Improve budget page ledger UI"
```

Expected: commit succeeds with only this task's files.
