# Performance P0 P1 P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. User explicitly requested no subagents.

**Goal:** Reduce dashboard backend work, route first-load JS, and dashboard client payload without changing product behavior.

**Architecture:** Keep current SWR/client-page structure, but remove unused dashboard analytics work, push click-only Plaid/split UI behind dynamic imports, and move dashboard monthly summary/review calculations to the API response so the page does not receive/reduce full month transactions.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase route handlers, node:test source guards, Turbopack route bundle diagnostics.

---

### Task 1: Add source-guard tests

**Files:**
- Modify: `/Users/maple/Documents/accountant/test/frontend-performance-guards.test.ts`

- [ ] Add tests proving dashboard analytics is not imported, dashboard page no longer reduces `monthTx`, Plaid manage link is lazy-loaded, and split editor is lazy-loaded.
- [ ] Run `npm run pretest && node --import ./test/register-alias.mjs --test .tmp-tests/test/frontend-performance-guards.test.js`; expected RED before production changes.

### Task 2: Dashboard backend payload/work reduction

**Files:**
- Modify: `/Users/maple/Documents/accountant/src/app/api/dashboard/route.ts`
- Modify: `/Users/maple/Documents/accountant/src/app/(dashboard)/dashboard/page.tsx`
- Modify: `/Users/maple/Documents/accountant/src/features/dashboard/types.ts`

- [ ] Remove unused analytics import/call/response field from dashboard API.
- [ ] Add `summary` with monthly totals, review counts, and largest driver computed server-side.
- [ ] Make dashboard page consume `summary` instead of reducing `monthTx`.

### Task 3: Lazy-load click-only UI

**Files:**
- Create: `/Users/maple/Documents/accountant/src/components/accounts/PlaidManageAccountsLauncher.tsx`
- Modify: `/Users/maple/Documents/accountant/src/components/accounts/PlaidManageAccountsButton.tsx`
- Create: `/Users/maple/Documents/accountant/src/components/transactions/SplitEditorDrawer.tsx`
- Modify: `/Users/maple/Documents/accountant/src/app/(dashboard)/transactions/page.tsx`

- [ ] Move `react-plaid-link` hook into the launcher and dynamic-import it from the button.
- [ ] Move split editor helpers/component into its own client component and dynamic-import it from Transactions.

### Task 4: Verify and commit

**Files:**
- Verify changed source files and route stats.

- [ ] Run focused performance guard test.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build` and compare `.next/diagnostics/route-bundle-stats.json`.
- [ ] Commit only scoped changed files; preserve pre-existing `/Users/maple/Documents/accountant/AGENTS.md` modification.
