# Scriptable Recent Transactions Widget

This widget uses `GET /api/widget/recent-transactions` to show the latest safe transaction summary in an iPhone large Scriptable widget.

## Setup

1. Open Accountant settings and create an API key.
2. Copy `docs/scriptable/recent-transactions-widget.js` into a new Scriptable script.
3. Replace `PASTE_YOUR_API_KEY_HERE` with the `ak_...` token shown when the key is created.
4. Keep `APP_URL` as `https://accountant-rose.vercel.app/transactions`, or change it to the page you want the widget to open.
5. Add a large Scriptable widget to the iPhone Home Screen and select this script.

## Notes

- iOS controls widget refresh timing, so updates are not real time.
- Tapping the widget opens `APP_URL`.
- If the widget stops refreshing, open Scriptable once and run the script manually.
- The key currently reuses the existing `api_keys` table used by iOS receipt upload. Treat it as a sensitive secret. The API is read-only for this widget route, and the route is written so scoped keys such as `widget:read` can be added later.

## API Checks

Browser session test while logged in:

```txt
/api/widget/recent-transactions
```

API key test:

```bash
curl -H "Authorization: Bearer ak_xxx" \
  "https://accountant-rose.vercel.app/api/widget/recent-transactions?limit=7"
```

Unauthenticated requests should return `401`.
