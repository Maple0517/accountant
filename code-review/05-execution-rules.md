# Execution Rules

请严格遵守以下执行规则。

---

# Phase 1: Read-Only Audit

第一阶段只能读代码，不能修改代码。

你需要读取：

- package.json
- lockfile
- README
- env example
- framework config
- tsconfig
- lint config
- database schema / migrations
- app routes
- API routes
- shared lib
- transaction-related files
- account-related files
- budget-related files
- category-related files
- Plaid-related files
- AI categorization files

输出：

- 项目概览
- 主要发现
- 高风险区域
- 初步问题列表

---

# Phase 2: Plan Before Changes

在修改任何文件之前，输出 Implementation Plan。

每一项必须包含：

- 要修什么
- 为什么修
- 涉及文件
- 是否改变业务行为
- 风险
- 验证命令

---

# Phase 3: Safe Immediate Fixes

允许优先修：

- TypeScript 明确错误
- lint 明确错误
- build 明确错误
- 不改变行为的 dead code 删除
- 明确重复 helper 合并
- 明显缺失的错误处理
- 明显不一致的 API response helper
- 小范围类型收紧
- 明确的 user_id 查询遗漏，如果能安全验证
- 明确的 missing loading / empty / error state，如果不改变数据语义

---

# Phase 4: Verification

每轮修改后至少运行一种验证：

- typecheck
- lint
- test
- build
- targeted test
- manual reasoning with file-level explanation

如果项目没有对应命令，需要明确指出。

---

# Phase 5: Stop Conditions

遇到以下情况时，不要继续修改：

- 修改影响金额计算但没有测试
- 修改影响 Plaid sync 但无法模拟
- 修改影响数据库 schema 但没有 migration plan
- 修改影响用户数据隔离但无法验证
- 修改范围超过原计划
- 发现需求不明确
- 验证失败且原因不清楚

---

# Commit-Style Output

每轮修改后，输出类似 commit summary：

```md
## Change Set 1

Changed:

- file A
- file B

Why:

- ...

Verification:

- command: ...
- result: ...

Remaining Risk:

- ...
```

---

# Do Not

不要做以下事情：

- 不要全项目格式化。
- 不要重写整个模块。
- 不要引入新依赖，除非必要且说明原因。
- 不要删除看似没用但业务不确定的代码。
- 不要把 mock data 当 dead code 删除，除非确认。
- 不要修改金额正负号规则，除非确认现有规则错误。
- 不要修改日期归属规则，除非确认现有规则错误。
- 不要改变 AI 分类覆盖逻辑，除非确认业务规则。
- 不要在没有测试的情况下重写 Plaid sync。
