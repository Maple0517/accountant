# Scriptable Recent Transactions Widget

This folder contains the iPhone Scriptable large-widget integration for Accountant.

The widget renders a compact dark recent-transactions list using:

```txt
GET /api/widget/recent-transactions
```

It is not a native iOS app, WidgetKit extension, or PWA. The iPhone widget is a copy-paste Scriptable script backed by the Accountant API.

## Files

```txt
docs/scriptable/recent-transactions-widget.js
docs/scriptable/README.md
```

## Current Widget Design

The current script is tuned for the iOS large Scriptable widget preview:

- Full-width dark list panel.
- Seven recent transaction rows by default.
- Divider-based list rows instead of separate card rows.
- Merchant and account/date subtitle on the left.
- Category pill in the middle.
- Right-aligned amount column.
- Reserved pending-dot slot so amounts do not shift row to row.
- Header shows API fetch time.
- Footer shows backend Plaid sync time when available.

Important layout constants live near the top of `recent-transactions-widget.js`:

```js
const MAX_TRANSACTIONS = 7
const CONTENT_WIDTH = 336
const ROW_HEIGHT = 39
const LEFT_WIDTH = 146
const PILL_WIDTH = 72
const AMOUNT_WIDTH = 78
const DOT_WIDTH = 9
```

If a future iPhone size clips content, reduce `CONTENT_WIDTH`, `ROW_HEIGHT`, or `MAX_TRANSACTIONS`. If the widget has unused right-side space, increase `CONTENT_WIDTH` first, then rebalance `LEFT_WIDTH`, `PILL_WIDTH`, and `AMOUNT_WIDTH`.

## Setup

1. Open Accountant in the browser and sign in.
2. Go to `Settings`.
3. Find the `iOS Shortcut Capture` section.
4. Click `Generate key`.
5. Copy the `ak_...` token immediately. The raw token is only shown once.
6. Open Scriptable on iPhone.
7. Create a new script.
8. Paste the full contents of `recent-transactions-widget.js`.
9. Replace only this line:

```js
const API_KEY = "PASTE_YOUR_API_KEY_HERE"
```

with:

```js
const API_KEY = "ak_your_key_here"
```

Do not include `Bearer` in `API_KEY`. The script adds the `Authorization: Bearer ...` header itself.

## Script Configuration

Default production config:

```js
const API_URL = "https://accountant-rose.vercel.app/api/widget/recent-transactions"
const API_KEY = "PASTE_YOUR_API_KEY_HERE"
const APP_URL = "https://accountant-rose.vercel.app/transactions"
const MAX_TRANSACTIONS = 7
```

`API_URL` should point to the deployed Accountant widget endpoint.

`API_KEY` should be the copied `ak_...` token only.

`APP_URL` is opened when tapping the widget.

`MAX_TRANSACTIONS` controls how many rows the API returns and the widget renders.

## Adding The iPhone Widget

1. Run the script once inside Scriptable with `presentLarge()` to preview it.
2. Long-press the iPhone Home Screen.
3. Add a Scriptable widget.
4. Choose the large size.
5. Edit the widget and select this script.

iOS controls widget refresh timing. The widget does not update in real time.

## Time Labels

The widget intentionally separates fetch time from backend sync time:

```txt
Header: Fetched just now
Footer: Synced 5h ago
```

`Fetched ...` means Scriptable just called the Accountant API and received a response.

`Synced ...` means the backend last successfully synced Plaid transactions, based on the latest non-null `plaid_items.last_synced_at` for the user.

If no backend sync timestamp is available, the footer falls back to:

```txt
Fetched just now
```

That fallback means the widget can load, but the API did not find a Plaid sync timestamp for the user.

## API Response Shape

The endpoint returns a compact payload:

```ts
type WidgetRecentTransactionsResponse = {
  updatedAt: string
  lastSyncedAt: string | null
  count: number
  transactions: WidgetTransaction[]
}
```

Each transaction includes only widget-safe fields:

```ts
type WidgetTransaction = {
  id: string
  merchant: string
  subtitle: string
  amount: number
  currency: string
  date: string
  dateLabel: string
  pending: boolean
  isIncome: boolean
  kind: 'normal' | 'refund' | 'reimbursement' | 'transfer'
  category: {
    id: string | null
    name: string
    label: string
    icon: string | null
    color: string | null
    type: 'income' | 'expense' | 'transfer' | null
  }
}
```

The API does not return user email, Plaid access tokens, Notion tokens, raw API keys, or full account numbers.

## API Auth

The widget endpoint supports:

- Supabase web session cookies, useful for browser testing while logged in.
- Existing hashed `api_keys`, useful for Scriptable.

Scriptable uses:

```txt
Authorization: Bearer ak_xxx
```

The raw key is never stored by the app. The backend hashes incoming keys and compares them to the `api_keys.key_hash` value.

## API Checks

Browser session test while logged in:

```txt
/api/widget/recent-transactions
```

Production API-key test:

```bash
curl -H "Authorization: Bearer ak_xxx" \
  "https://accountant-rose.vercel.app/api/widget/recent-transactions?limit=7"
```

Expected unauthenticated result:

```json
{"error":"Unauthorized"}
```

A `401` without an API key means the route exists and auth is working. A `404` means the deployment does not have the widget route yet.

## Troubleshooting

`Unable to load transactions`

Usually means the API key is wrong, missing, revoked, pasted with `Bearer`, or the production deployment does not include the widget endpoint yet.

`Updated just now` still appears

The phone is running an old copy of the script. The current script uses `Fetched ...` and `Synced ...`.

Bottom says `Fetched just now` instead of `Synced ...`

The API did not find a non-null Plaid `last_synced_at` for the user. Open Accountant, run a Plaid transaction refresh, then run the Scriptable script again.

Rows are clipped vertically

Reduce `ROW_HEIGHT`, `MAX_TRANSACTIONS`, or font sizes. The large widget has limited height and iOS may render slightly differently across devices.

Right side has unused space

Increase `CONTENT_WIDTH`, then rebalance `LEFT_WIDTH`, `PILL_WIDTH`, and `AMOUNT_WIDTH`.

Amounts do not align

Keep `AMOUNT_WIDTH` and `DOT_WIDTH` fixed. The pending-dot slot must stay reserved even when a row is not pending.

Generated API key disappeared

Raw keys are shown once. Generate a new key in Settings and revoke the old one if needed.

## Security Notes

- Treat `ak_...` as a sensitive secret.
- The widget route is read-only.
- The current key table is shared with iOS receipt upload.
- The route is structured so scoped keys such as `widget:read` can be added later.
- Do not paste the key into screenshots, issues, commits, or shared docs.

## Deployment Notes

After changing the widget API or script:

```bash
npm run typecheck
npm run lint -- docs/scriptable/recent-transactions-widget.js src/app/api/widget/recent-transactions/route.ts
npm test
git push origin main
```

For script-only visual tweaks, targeted lint on `recent-transactions-widget.js` is usually enough before commit.

After pushing `main`, verify the live route:

```bash
curl -i "https://accountant-rose.vercel.app/api/widget/recent-transactions?limit=1"
```

Without auth, a deployed route should return `401`, not `404`.
