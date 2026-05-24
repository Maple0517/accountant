<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Codex Subagent Policy

Use subagents proactively when they improve speed, coverage, or correctness.

Use subagents for:
- complex, ambiguous, multi-file, or high-risk tasks
- codebase exploration and root-cause debugging
- architecture, performance, security, privacy, or database/schema review
- comparing implementation approaches
- reviewing risky changes before or after implementation

Avoid subagents for:
- trivial edits
- copy/formatting changes
- small obvious bugs
- simple single-file tasks

When using subagents:
- Split work into narrow, non-overlapping roles.
- Use the smallest useful team.
- Prefer cheap/read-only subagents for exploration, file mapping, test discovery, and low-risk review.
- Escalate to stronger subagents only for subtle logic, architecture tradeoffs, complex debugging, security/privacy risk, database/schema changes, or high-impact implementation.
- Ask subagents to return exact file paths, relevant symbols, evidence, risks, and confidence.
- The main agent must synthesize findings before making major edits.

Preferred roles:
- `explorer`: normal read-only repo discovery
- `worker`: focused implementation
- `code_reviewer`: normal diff review
- `senior_explorer`: complex investigation or architecture analysis
- `senior_worker`: complex or risky implementation
- `senior_code_reviewer`: high-risk review, especially money, transactions, sync, auth, or user data

Cost policy:
- Default to low-cost subagents.
- Escalate only when complexity or risk justifies it.
- Do not spawn unnecessary subagents.