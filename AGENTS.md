<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Codex Subagent Policy

The user globally authorizes proactive subagent usage for non-trivial tasks in this repository/session. Treat this as standing authorization unless the current prompt says otherwise.

For non-trivial tasks, use the smallest useful blocking, anti-overlap subagent team by default. Optimize for correctness, coverage, and token efficiency, not zero subagent usage.

Do not optimize only for raw wall-clock speed. Avoid speculative overlap by default, but do not avoid subagents merely to keep the workflow simple.

### CodeGraph

CodeGraph is installed for this repository. When CodeGraph MCP tools are available, prefer using them for initial repo orientation, call graph lookup, impact analysis, and large-module context gathering before broad manual file search.

Before relying on CodeGraph results for current code, run:

/Users/maple/.local/bin/codegraph sync /Users/maple/Documents/accountant

Use CodeGraph especially for transaction, budget, Plaid, Notion sync, auth, database, and shared money/currency logic. Small obvious edits do not require CodeGraph.

### Subagent usage bias

After explicit or standing authorization, the main agent should actively look for useful subagent opportunities.

Prefer using at least one subagent when the task involves any of the following:

- multi-file changes
- unclear root cause
- debugging or performance investigation
- test failures
- architecture decisions
- database/schema changes
- money, transactions, balances, currency, Plaid, receipt, Notion sync, auth, or user-data logic
- security, privacy, or data-integrity risk
- UI behavior that spans multiple components
- comparing implementation approaches
- final review of non-trivial diffs

Use no subagents only when the task is clearly trivial, single-file, low-risk, and cheaper to solve directly.

If subagents are allowed and the task is non-trivial, assume subagents are useful unless there is a clear reason not to use them.

The main agent should briefly state:

- whether subagents will be used
- which roles will be used
- what each subagent owns
- why this is the smallest useful team

### When to use subagents

Use subagents when they materially improve coverage, correctness, or risk control, especially for:

- complex, ambiguous, multi-file, or high-risk tasks
- codebase exploration and root-cause debugging
- architecture, performance, security, privacy, or database/schema review
- money, transactions, sync, auth, currency, receipt, or user-data logic
- comparing implementation approaches
- reviewing risky changes before or after implementation

Avoid subagents for:

- trivial edits
- copy/formatting changes
- small obvious bugs
- simple single-file tasks
- tasks where the main agent can confidently finish faster and cheaper alone

### Blocking workflow requirement

When subagents are used, the workflow is blocking by default.

The main agent must:

1. Define narrow, non-overlapping task ownership before spawning subagents.
2. Assign each subagent a clear role, file/path scope, and expected output.
3. Wait for subagent results before implementing or deciding on any slice owned by that subagent.
4. Synthesize subagent findings before major edits, architecture decisions, or final responses.
5. Explicitly report if a subagent fails, times out, or returns incomplete findings.

Subagent results are required inputs, not optional background work.

### Anti-overlap rule

Do not use speculative parallelism by default.

If a subagent owns a task slice, the main agent must not independently implement the same slice while waiting for that subagent.

While waiting, the main agent may only work on:

- unrelated slices
- orchestration
- integration planning
- reading relevant documentation
- test planning
- preparing verification steps
- reviewing already-returned results

The main agent must not duplicate assigned subagent work unless the user explicitly prioritizes speed over token cost.

### Cost policy

Default to the smallest useful low-cost team.

- Prefer cheap/read-only subagents for exploration, file mapping, test discovery, and low-risk review.
- Use worker subagents only for clearly bounded implementation slices.
- Escalate to stronger subagents only for subtle logic, architecture tradeoffs, complex debugging, security/privacy risk, database/schema changes, or high-impact implementation.
- Do not spawn unnecessary subagents.
- Prefer the smallest useful team, but do not under-delegate complex work. For non-trivial tasks, one explorer or reviewer is often justified even when implementation remains in the main thread.

### Preferred roles

- `explorer`: normal read-only repo discovery
- `worker`: focused implementation for a bounded slice
- `code_reviewer`: normal diff review
- `senior_explorer`: complex investigation or architecture analysis
- `senior_worker`: complex or risky implementation
- `senior_code_reviewer`: high-risk review, especially money, transactions, sync, auth, currency, receipts, or user data

### Subagent output requirements

Ask every subagent to return:

- exact file paths inspected or changed
- relevant symbols, functions, routes, components, or schemas
- concrete evidence for findings
- risks and edge cases
- recommended next steps
- confidence level
- whether the task overlapped with any other assigned slice

### Default workflow

For complex tasks, use this pattern:

1. Main agent reads the task and decides whether subagents are justified.
2. Main agent defines non-overlapping slices.
3. Explorer subagents investigate if uncertainty is high.
4. Main agent synthesizes explorer findings.
5. Worker subagents implement only clearly bounded slices if useful.
6. Main agent integrates results and resolves conflicts.
7. Reviewer subagent reviews risky diffs when justified.
8. Main agent runs verification and summarizes final changes.

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

Use `senior_code_reviewer` for high-risk review only when the change is complex or correctness-critical.