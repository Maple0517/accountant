# Startup Shell Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce first-open loading by removing duplicate auth blocking in the dashboard layout and collapsing dashboard bootstrap requests.

**Architecture:** Keep auth enforcement at the request boundary in `src/proxy.ts`, let the dashboard layout render the shell without a second auth roundtrip, and fetch full dashboard bootstrap data in one request. The change stays intentionally narrow and avoids a repo-wide data-fetch rewrite.

**Tech Stack:** Next.js 16 App Router, Next Proxy, Supabase SSR, React 19, SWR, Node test runner, TypeScript

---

### Task 1: Lock auth-boundary behavior with tests

**Files:**
- Create: `test/proxy.test.ts`
- Modify: `src/proxy.ts`
- Test: `test/proxy.test.ts`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement minimal proxy helpers and matcher fix**
- [ ] **Step 4: Run test to verify it passes**

### Task 2: Remove duplicate layout auth blocking

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`
- Modify: `src/components/layout/AppShell.tsx` (only if prop defaults need adjustment)

- [ ] **Step 1: Remove request-time user lookup from the dashboard layout**
- [ ] **Step 2: Keep locale bootstrapping and shell render intact**
- [ ] **Step 3: Re-read layout and shell for null-safe behavior**

### Task 3: Collapse dashboard bootstrap requests

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx`
- Modify: `src/app/api/dashboard/route.ts` (only if response shape needs cleanup)

- [ ] **Step 1: Switch the page to `/api/dashboard?include=full`**
- [ ] **Step 2: Remove follow-up analytics and budget SWR bootstrap requests**
- [ ] **Step 3: Preserve existing rendering behavior using embedded dashboard payload**

### Task 4: Verify and commit

**Files:**
- Verify only

- [ ] **Step 1: Run `npm test -- test/proxy.test.ts`**
- [ ] **Step 2: Run `npm test`**
- [ ] **Step 3: Run `npm run lint`**
- [ ] **Step 4: Run `npm run typecheck`**
- [ ] **Step 5: Manually open local app and verify first-open shell behavior**
- [ ] **Step 6: Commit focused changes**
