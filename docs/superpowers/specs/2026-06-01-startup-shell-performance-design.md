# Startup Shell Performance Design

**Goal**
Improve first-open perceived performance by rendering the dashboard shell sooner and removing redundant dashboard bootstrap requests.

## Problem
The current first-open path does extra work before the user sees useful UI:
- request auth is already checked in `src/proxy.ts`
- `src/app/(dashboard)/layout.tsx` performs a second `supabase.auth.getUser()` before rendering the shell
- `src/app/(dashboard)/dashboard/page.tsx` fetches `/api/dashboard`, then separately fetches analytics and budget data that the dashboard API can already return

This produces a noticeable empty/loading phase before content appears.

## Chosen approach
1. Keep auth gating in Next 16 `proxy.ts`, not in the dashboard layout.
2. Make the dashboard layout render the shell without awaiting user lookup.
3. Bootstrap the dashboard page with `/api/dashboard?include=full` so the first load does one dashboard request instead of one plus follow-up requests.
4. Extend proxy path protection to include `/review`, which is currently protected only indirectly by the layout auth check.

## Non-goals
- No full server-first rewrite of all dashboard pages.
- No broad SWR architecture refactor.
- No unrelated UI redesign.

## Risks
- Header/sidebar will no longer have guaranteed server-side email on first paint; they should tolerate `null`.
- Removing layout auth must not expose dashboard routes, so `proxy.ts` must cover every protected route.

## Verification
- Add focused route-auth tests for proxy path decisions.
- Run targeted tests, lint, and typecheck.
- Manually open the local app and verify first open shows the shell immediately and dashboard data loads without extra blocking.
