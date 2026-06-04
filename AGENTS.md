<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->


### CodeGraph

CodeGraph is installed for this repository. When CodeGraph MCP tools are available, prefer using them for initial repo orientation, call graph lookup, impact analysis, and large-module context gathering before broad manual file search.

Before relying on CodeGraph results for current code, run:

/Users/maple/.local/bin/codegraph sync /Users/maple/Documents/accountant

Use CodeGraph especially for transaction, budget, Plaid, Notion sync, auth, database, and shared money/currency logic. Small obvious edits do not require CodeGraph.


### High-risk areas

For the following areas, prefer extra review before finalizing:

- money calculations
- transactions
- account balances
- currency conversion
- Plaid sync
- receipt parsing
- Notion sync
- authentication
- authorization
- database schema changes
- user data privacy