<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This repo uses a newer Next.js version with breaking API/convention changes. Before changing Next.js behavior, read the relevant guide under `node_modules/next/dist/docs/` and follow deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent rules — Accountant

## How to work here

- Use Simplified Chinese for user-facing updates unless asked otherwise.
- Prefer small, focused changes. Do not refactor unrelated finance logic.
- Read the current code before judging behavior; docs in this repo can lag code.
- After code changes, run the narrowest useful checks, re-read changed files, then create a focused commit.
- For docs-only changes, run markdown/link sanity checks and do not run expensive app builds unless docs embed generated code.

## CodeGraph

CodeGraph is installed for this repository. Use it for initial orientation, call graphs, impact checks, and large-module context in these areas:

- transactions
- budgets
- Plaid sync
- Notion sync
- auth/authorization
- database schema
- money/currency helpers

Before relying on CodeGraph results for current code, run:

```bash
/Users/maple/.local/bin/codegraph sync /Users/maple/Documents/accountant
```

Small obvious edits do not require CodeGraph.

## High-risk areas

Treat these as production-sensitive and add extra review/verification:

- money calculations and report semantics
- transaction treatment, split, refund, transfer, and deletion behavior
- account balances and archive/delete-history behavior
- currency filtering/conversion
- Plaid tokens, sync cursors, webhooks, and cron sync
- receipt parsing and API keys
- Notion token/database sync
- authentication, authorization, RLS, and service-role usage
- Supabase migrations and RPCs
- user data privacy and logs

## Documentation rules

- `README.md` is the human entrypoint.
- `AI_HANDOFF.md` is the agent handoff and should stay concise/current.
- `docs/ARCHITECTURE.md` is durable system architecture.
- `docs/OPERATIONS.md` is setup/deploy/runbook.
- Delete stale implementation plans instead of letting them become fake truth.
