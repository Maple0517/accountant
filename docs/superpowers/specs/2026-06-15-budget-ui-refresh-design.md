# Budget UI refresh design

## Goal

Improve the budget page scanability and budget semantics without changing budget calculations, API contracts, or transaction behavior.

## Current problem

The page currently renders separate cards per status group. Each category row has a border, a budget edit pill, a status badge, and a full progress bar. On wide screens this creates too many horizontal lines and makes the page feel like a repeated form list. Categories without budgets also show `spent of $0.00`, which is technically derived from the data but reads like a broken or overspent budget.

## Chosen approach

Use a calm ledger layout:

- Keep the existing data flow, edit behavior, details drawer, SWR mutation, and status grouping.
- Replace multiple category group cards with one category ledger card.
- Add a compact summary strip at the top with total budget, spent, remaining, and unbudgeted spend.
- Make category rows rely on spacing and status tint instead of repeated borders.
- Reduce horizontal line density by keeping only one header divider and using short progress bars.
- Treat unbudgeted categories explicitly as `unbudgeted` or `no budget set`, not `spent of $0.00`.

## UX details

- Summary strip uses four metric cards: total budget, spent, remaining, unbudgeted spend.
- Unbudgeted spend is computed client-side from categories where `baseBudget <= 0` and `actualSpend > 0`.
- The ledger keeps groups in existing order: over, watch, on track, no budget.
- Group labels become small section dividers inside one card, not separate large cards.
- Configured categories show `spent / budget`, remaining badge, and a short progress meter.
- Unbudgeted categories with spend show `<amount> unbudgeted`, a stronger `Set budget` action, and a warm tinted row.
- No-spend categories without budget show `No budget set`, muted helper text, and a quieter `Set budget` action.
- Editing still happens inline in the action column.
- Clicking category name still opens the details drawer.

## Implementation scope

Modify only:

- `src/app/(dashboard)/budgets/page.tsx`
- `src/app/globals.css`
- `src/i18n/namespaces/budgets.ts`

No database, API, budget math, transaction logic, or drawer behavior changes.

## Verification

- Typecheck the app.
- Lint the touched files through the existing lint command.
- Re-read changed files after implementation.
- Do not run a full production build unless typecheck/lint indicate a build-specific issue.
