# Final Report Format

最终输出请严格按以下结构。

---

# 1. Project Overview

```md
## Project Overview

- Tech Stack:
- Package Manager:
- Framework:
- Database:
- Auth:
- Third-Party Services:
- Main Modules:
- Available Commands:
- Missing Commands:
```

---

# 2. Core Business Flow Summary

```md
## Core Business Flows

### Transaction Sync Flow

1. ...
2. ...
3. ...

### Transaction Display Flow

1. ...
2. ...
3. ...

### Budget Calculation Flow

1. ...
2. ...
3. ...

### AI Categorization Flow

1. ...
2. ...
3. ...
```

如果某个流程当前不存在，请明确说：

```md
Not found in current codebase.
```

---

# 3. Multi-Agent Findings

按 Agent 输出：

```md
## Findings By Agent

### Finance Domain Agent

#### [P?] Issue Title

- Files:
- Description:
- Impact:
- Risk:
- Fix Complexity:
- Confidence:
- Recommended Fix:
- Verification:
```

每个 Agent 至少输出真实检查结果。  
如果某个 Agent 没发现问题，也要说明检查了什么。

---

# 4. Prioritized Technical Debt Table

```md
## Prioritized Technical Debt

| Priority | Issue | Files | User Impact | Data Risk | Security Risk | Complexity | Action |
|---|---|---|---|---|---|---|---|
| P0 | ... | ... | ... | ... | ... | ... | ... |
```

---

# 5. Immediate Fix Plan

```md
## Immediate Fix Plan

### Fix 1: ...

- Why:
- Files:
- Business Behavior Change:
- Risk:
- Verification:
```

---

# 6. Changes Executed

每轮修改后输出：

```md
## Changes Executed

### Change Set 1

Changed Files:

- ...

What Changed:

- ...

Why:

- ...

Verification:

- Command:
- Result:

Remaining Risk:

- ...
```

如果没有执行修改，请说明原因。

---

# 7. Verification Summary

```md
## Verification Summary

| Command | Result | Notes |
|---|---|---|
| ... | Passed / Failed / Not Available | ... |
```

---

# 8. Roadmap

```md
## Technical Debt Roadmap

### Short-Term

- ...

### Medium-Term

- ...

### Long-Term

- ...
```

---

# 9. Final Recommendation

```md
## Final Recommendation

- What is safe to merge now:
- What should be reviewed by human:
- What should not be touched yet:
- Highest leverage next step:
```
