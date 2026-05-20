# AI Handoff Document: Automated Personal Finance Tracker

Hello fellow AI Agent (Claude / Codex / etc)! 

You are taking over an **Automated Personal Finance Tracker** project built for the user. Here is a comprehensive brain-dump of the project's current state, tech stack, and important context so you can hit the ground running.

## 🚀 Tech Stack
- **Framework:** Next.js 14+ (App Router)
- **Styling:** Tailwind CSS + Radix UI (shadcn/ui-like components)
- **Database / Auth:** Supabase (PostgreSQL)
- **Bank Sync API:** Plaid (Currently configured for `production` environment)
- **Target Export/Sync:** Notion API

## 📂 Core Architecture
- `/src/app`: Contains the Next.js App Router pages.
  - `(dashboard)`: Contains the main authenticated views (`/accounts`, `/transactions`, `/settings`).
- `/src/components`: UI components.
- `/src/lib`: Core integrations.
  - `/src/lib/plaid`: Plaid client initialization and sync logic.
  - `/src/lib/notion`: Notion API integration and database management.
  - `/src/lib/supabase`: Supabase client definitions.

## 🗄️ Database Schema (Supabase)
1. **`profiles`**
   - Stores user configuration.
   - Columns: `id` (uuid, references auth.users), `notion_token`, `notion_database_id`.
2. **`plaid_items`**
   - Stores connected bank credentials.
   - Columns: `id`, `user_id`, `item_id`, `access_token`, `institution_name`, `cursor` (for transactions sync state).
3. **`accounts`**
   - Caches Plaid accounts for the UI.
   - Columns: `id`, `user_id`, `item_id`, `account_id`, `name`, `mask`, `official_name`, `current_balance`, `available_balance`, `iso_currency_code`, `type`, `subtype`.
4. **`transactions`**
   - Caches transactions synced from Plaid.
   - Columns: `id`, `user_id`, `account_id`, `plaid_transaction_id`, `name`, `amount`, `date`, `category`, `merchant_name`, `pending`.

## ⚠️ Critical Quirks & Workarounds (MUST READ)
1. **Notion SDK Bug:** 
   We encountered a bug in the official `@notionhq/client` where the `databases.create` endpoint strips out the `properties` payload, resulting in a blank database. 
   - **Workaround:** In `src/lib/notion/sync.ts`, the `createTransactionDatabase` function **bypasses the Notion SDK** and uses a native `fetch` POST request to `https://api.notion.com/v1/databases` to ensure the columns are created correctly. *Do not revert this to using the Notion SDK unless Notion fixes it!*
2. **Plaid Production Environment:** 
   The app is currently configured for Plaid `production`. Since some major institutions (like Chase, Amex, Capital One) require strict OAuth app registration and approval from Plaid to work in production, Plaid Link might throw "Internal errors" for those specific banks. This is a Plaid Dashboard configuration issue, not a code issue.
3. **Supabase Auth:** 
   The user logs in via email/password. Ensure that any backend route testing passes the correct Supabase session/cookies.

## 🔑 Environment Variables
The `.env.local` file contains the following (DO NOT share these publicly):
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV`
- `GEMINI_API_KEY` (if used for smart categorizations in the future)

## 🎯 Next Steps / Pending Features
- **UI Enhancements:** The dashboard needs some CSS fixes (e.g., sidebar alignment).
- **AI Categorization:** The user wants to integrate an LLM (like Gemini) to auto-categorize and clean up Plaid merchant names before pushing to Notion.
- **Webhooks:** Set up Plaid webhooks to automatically trigger `/api/plaid/sync-transactions` instead of relying on manual syncing.

Good luck! Build something awesome.
