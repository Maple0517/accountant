# Plaid Standard Transaction Sync Design

## Purpose

This document defines the default Plaid transaction synchronization design for the Accountant app.

The app should **not** rely on Plaid `/transactions/refresh` as the default refresh mechanism because that endpoint is an optional paid add-on. The default implementation should use Plaid's standard Transactions flow:

```txt
Plaid automatic transaction extraction
    ↓
SYNC_UPDATES_AVAILABLE webhook
    ↓
/transactions/sync
    ↓
Persist added / modified / removed transactions into Supabase
```

This design aims to make transaction sync reliable, clear to users, and cost-safe for an MVP.

---

## Core Product Constraint

Plaid Transactions is **not** a real-time card authorization stream.

The app cannot guarantee that a purchase made a few minutes ago will immediately appear. New card transactions may take several hours or longer to become available, depending on the financial institution and whether Plaid receives pending transactions for that institution.

Therefore, the product should avoid wording like:

- Real-time transaction sync
- Force refresh latest bank transactions
- Instant transaction refresh
- Seconds-level updates

Preferred wording:

- Check for available updates
- Sync available Plaid updates
- Last checked
- Last synced

---

## Current Problem

The current account refresh button calls:

```txt
POST /api/plaid/sync-transactions
```

That route eventually calls:

```ts
plaidClient.transactionsSync({
  access_token,
  cursor,
})
```

This is correct for consuming transaction updates already available from Plaid, but it does **not** force Plaid to check the bank for newly authorized transactions.

The current behavior is not a frontend refresh bug. It is a product/architecture expectation issue.

---

## Explicit Non-Goal

Do **not** use this as the default transaction refresh mechanism:

```ts
plaidClient.transactionsRefresh(...)
```

`/transactions/refresh` may be added later only as a paid optional feature behind an explicit feature flag.

Suggested future flag:

```env
PLAID_ENABLE_PAID_TRANSACTION_REFRESH=false
```

Default value must remain `false`.

---

## Desired Architecture

### Primary path: webhook-driven sync

```txt
Plaid detects transaction changes
    ↓
Plaid sends TRANSACTIONS / SYNC_UPDATES_AVAILABLE webhook
    ↓
/api/plaid/webhook receives webhook
    ↓
syncPlaidItemTransactions(...)
    ↓
plaidClient.transactionsSync({ access_token, cursor })
    ↓
Persist added / modified / removed transactions
    ↓
Save next_cursor and last_synced_at
```

### Fallback path: scheduled sync

```txt
Vercel Cron or scheduled job
    ↓
/api/cron/plaid-sync
    ↓
Find all active plaid_items
    ↓
Call syncPlaidItemTransactions(...) for each item
    ↓
Persist any available Plaid updates
```

### Manual user action

```txt
User clicks account refresh button
    ↓
Optional: sync account balances
    ↓
Call /api/plaid/sync-transactions
    ↓
Pull only updates already available from Plaid
    ↓
Update Last checked / Last synced UI
```

The manual button should not imply that the bank is being forced to produce new transactions.

---

## Existing Files Involved

```txt
src/lib/plaid/client.ts
src/lib/plaid/transactions-sync.ts
src/app/api/plaid/create-link-token/route.ts
src/app/api/plaid/exchange-token/route.ts
src/app/api/plaid/sync-transactions/route.ts
src/app/api/plaid/webhook/route.ts
src/app/(dashboard)/accounts/page.tsx
src/components/accounts/AccountCard.tsx
supabase/migrations/
```

---

## Task 1: Keep and Strengthen /transactions/sync

The existing helper should remain the central transaction import function:

```txt
src/lib/plaid/transactions-sync.ts
```

It should continue to:

1. Load `plaid_items.access_token` and `plaid_items.cursor`.
2. Call `plaidClient.transactionsSync({ access_token, cursor })`.
3. Loop while `has_more` is true.
4. Accumulate:
   - `added`
   - `modified`
   - `removed`
5. Upsert `added` and `modified` transactions.
6. Delete locally stored transactions that Plaid returns in `removed`.
7. Save the final `next_cursor`.
8. Preserve existing category/classification behavior.
9. Preserve existing Notion sync behavior.
10. Preserve pending transactions; do not filter them out.

Do not rewrite this helper unless necessary.

---

## Task 2: Add Plaid Item Sync Metadata

Create a new Supabase migration:

```txt
supabase/migrations/xxx_add_plaid_item_sync_metadata.sql
```

Migration:

```sql
ALTER TABLE plaid_items
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_sync_error TEXT;
```

On successful transaction sync, update:

```ts
await supabase
  .from('plaid_items')
  .update({
    cursor,
    last_synced_at: new Date().toISOString(),
    last_sync_error: null,
  })
  .eq('id', plaidItemId)
  .eq('user_id', itemUserId)
```

If sync fails in an API route, store a safe error string:

```ts
await supabase
  .from('plaid_items')
  .update({
    last_sync_error: errorMessage,
  })
  .eq('id', plaid_item_id)
  .eq('user_id', user.id)
```

Do not expose Plaid `access_token` or full Plaid raw error payloads to the frontend.

---

## Task 3: Clarify Manual Sync API Response

Modify:

```txt
src/app/api/plaid/sync-transactions/route.ts
```

Current behavior should stay the same, but the response should be clearer:

```ts
return Response.json({
  ...result,
  message:
    'Synced transaction updates already available from Plaid. This does not force the bank to produce new pending transactions.',
})
```

This helps future debugging and prevents product misunderstanding.

---

## Task 4: Add Scheduled Fallback Sync

Create:

```txt
src/app/api/cron/plaid-sync/route.ts
```

Purpose:

- Webhook remains the primary path.
- Cron is a fallback path.
- It protects against missed webhooks, local development gaps, or webhook configuration mistakes.

### Environment variable

```env
CRON_SECRET=your_random_secret
```

### Endpoint

Method:

```txt
GET
```

Authorization:

```txt
Authorization: Bearer ${CRON_SECRET}
```

### Implementation sketch

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { syncPlaidItemTransactions } from '@/lib/plaid/transactions-sync'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET

  if (!expected || authHeader !== `Bearer ${expected}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data: items, error } = await supabase
    .from('plaid_items')
    .select('id, user_id, status')
    .eq('status', 'active')

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const results = []

  for (const item of items || []) {
    try {
      const result = await syncPlaidItemTransactions({
        supabase,
        plaidItemId: item.id,
      })

      results.push({
        plaid_item_id: item.id,
        success: true,
        result,
      })
    } catch (error) {
      results.push({
        plaid_item_id: item.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return Response.json({
    success: true,
    checked_items: results.length,
    results,
  })
}
```

Important:

- One failed Plaid item must not stop all other items.
- Do not return `access_token`.
- Do not return long stack traces.

---

## Task 5: Add Vercel Cron Configuration

If deployed on Vercel, add or update:

```txt
vercel.json
```

Recommended schedule:

```json
{
  "crons": [
    {
      "path": "/api/cron/plaid-sync",
      "schedule": "0 */4 * * *"
    }
  ]
}
```

This runs every 4 hours.

A more aggressive but still reasonable option:

```json
{
  "crons": [
    {
      "path": "/api/cron/plaid-sync",
      "schedule": "0 */2 * * *"
    }
  ]
}
```

Do not run this every few minutes. Plaid Transactions is not a real-time stream, and excessive polling adds noise without guaranteeing fresher data.

---

## Task 6: Optional Balance Sync

Balance refresh is separate from transaction sync.

If desired, create:

```txt
src/app/api/plaid/sync-balances/route.ts
```

It should call:

```ts
plaidClient.accountsBalanceGet({
  access_token,
})
```

Then update local `accounts` rows:

```ts
await supabase
  .from('accounts')
  .update({
    current_balance: account.balances.current,
    available_balance: account.balances.available,
    iso_currency_code: account.balances.iso_currency_code || 'USD',
  })
  .eq('user_id', user.id)
  .eq('plaid_item_id', item.id)
  .eq('plaid_account_id', account.account_id)
```

Rules:

- Do not treat balance refresh as transaction refresh.
- Do not create fake transactions based on balance differences.
- Do not convert `null` balances to `0` unless the current app convention explicitly requires it.

Manual account button can optionally perform:

```txt
1. sync balances
2. sync available transactions
3. reload accounts
```

---

## Task 7: Update Account Refresh UI Semantics

Modify:

```txt
src/components/accounts/AccountCard.tsx
src/app/(dashboard)/accounts/page.tsx
```

The button title should be changed from:

```tsx
title="Sync transactions"
```

To:

```tsx
title="Check for available updates"
```

or:

```tsx
title="Sync available Plaid updates"
```

Avoid misleading labels such as:

```txt
Force refresh
Refresh latest transactions
Real-time sync
```

If refactoring names, prefer:

```ts
onSync -> onRefresh
syncing -> refreshing
handleSync -> handleRefresh
```

Minimal diff is acceptable if behavior and UI wording are clear.

---

## Task 8: Show Last Synced State

Expose `plaid_items.last_synced_at` in the account page UI.

Suggested display:

```txt
Last checked: 2:35 PM
```

or:

```txt
Last synced: May 21, 2:35 PM
```

If `last_sync_error` exists, show a safe lightweight message:

```txt
Last sync failed. Try again later.
```

Do not show sensitive Plaid errors or access tokens in UI.

---

## Task 9: Keep Existing Webhook Flow

Do not delete or replace:

```txt
src/app/api/plaid/webhook/route.ts
```

It should continue to process:

```txt
SYNC_UPDATES_AVAILABLE
DEFAULT_UPDATE
TRANSACTIONS_REMOVED
```

When a supported transaction webhook is received, it should continue to call:

```ts
syncPlaidItemTransactions(...)
```

Required production environment variables:

```env
PLAID_WEBHOOK_URL=https://your-domain.com/api/plaid/webhook?secret=...
PLAID_WEBHOOK_SECRET=...
```

If the app is running locally without a public webhook URL, automatic Plaid webhooks will not reach the local server.

---

## Task 10: Optional Paid On-Demand Refresh Feature Flag

Do not implement this by default.

If the app later wants paid on-demand Plaid refresh, use:

```env
PLAID_ENABLE_PAID_TRANSACTION_REFRESH=false
```

Only when this is explicitly set to `true`, allow:

```ts
plaidClient.transactionsRefresh(...)
```

This should be a separate endpoint and separate UI action, not the normal account refresh button.

Suggested paid UI wording:

```txt
Force bank refresh
```

But the default MVP flow should not include it.

---

## Validation Checklist

Run:

```bash
npm run lint
npm run build
```

If tests are available:

```bash
npm test
```

Manual checks:

1. Connect a Plaid bank account.
2. Confirm initial historical transactions still import.
3. Click account refresh.
4. Confirm it calls `/api/plaid/sync-transactions`.
5. If balance sync is implemented, confirm it also calls `/api/plaid/sync-balances`.
6. Confirm it does **not** call `plaidClient.transactionsRefresh` by default.
7. Confirm `plaid_items.cursor` updates after sync.
8. Confirm `plaid_items.last_synced_at` updates after sync.
9. Confirm webhook-driven sync still works for `SYNC_UPDATES_AVAILABLE`.
10. Confirm cron endpoint syncs all active Plaid items when called with `CRON_SECRET`.
11. Confirm UI does not promise real-time transaction visibility.

---

## Final Expected Behavior

After this change:

- The app uses Plaid's standard transaction sync model.
- The default flow does not depend on paid `/transactions/refresh`.
- Webhook is the primary sync path.
- Cron is the fallback sync path.
- Manual refresh checks Plaid updates that are already available.
- Account balances can optionally be refreshed separately.
- Users can see when the app last checked Plaid.
- Delayed pending transactions are treated as expected Plaid/institution behavior, not as an app bug.
