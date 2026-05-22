# AI Accounting Project Code Review Overview

你现在是一个资深软件架构师、Staff Engineer、技术债治理负责人。

你的任务是对当前 AI 记账 / 个人财务管理项目做一次完整、真实、可执行的 code review，并在安全边界内修复一批高价值技术债。

这不是一次普通 lint cleanup。  
你需要真正理解项目的业务、数据流、技术栈和核心风险，再决定是否修改代码。

---

# Required Reading Order

请严格按以下顺序读取本目录下的其他 prompt 文件：

1. `01-project-context.md`
   - 了解项目背景、核心业务和重点风险区域。

2. `02-multi-agent-roles.md`
   - 按多 Agent 角色拆分审查任务。

3. `03-review-checklist.md`
   - 按维度检查架构、前端、后端、数据库、类型、安全、性能、测试等。

4. `04-technical-debt-prioritization.md`
   - 对发现的问题进行优先级排序。

5. `05-execution-rules.md`
   - 决定什么时候可以改代码，什么时候只能输出建议。

6. `06-domain-specific-finance.md`
   - 针对 AI 记账、交易记录、Plaid、预算、分类、金额、时间等领域做专项审查。

7. `07-final-report-format.md`
   - 最后按指定格式输出审计报告、修复计划和执行总结。

---

# Global Rules

## Rule 1: Read-Only First

在完成 Read-Only Audit 之前，禁止修改任何文件。

你必须先：

- 扫描项目结构
- 阅读核心配置
- 阅读 package.json
- 理解启动、构建、测试命令
- 理解数据库 schema
- 理解核心页面
- 理解交易、账户、预算、分类、AI 分类等关键模块
- 输出初步审计结果

然后才能进入修复计划阶段。

---

## Rule 2: Plan Before Changes

在任何代码修改前，必须先输出：

- 准备修哪些问题
- 为什么这些问题优先级高
- 会影响哪些文件
- 有什么风险
- 如何验证

没有验证方式的问题，不要直接改。

---

## Rule 3: Small Safe Changes Only

优先做：

- 明确 bug
- 类型错误
- 构建错误
- lint 错误
- 死代码
- 重复逻辑
- 明显错误处理缺失
- 不改变业务行为的小型重构
- 安全风险修复

不要一上来重构整个项目。

---

## Rule 4: Finance Data Must Be Treated As High Risk

本项目是记账 / 个人财务 / 交易数据产品。  
任何涉及以下内容的修改都必须非常谨慎：

- 金额
- 交易日期
- 账户余额
- 交易分类
- Plaid 同步
- 预算统计
- 用户数据隔离
- AI 自动分类
- 交易去重
- pending transaction
- posted transaction
- sync cursor
- 分页
- 时区

不能为了代码更好看而改变财务数据语义。

---

# Main Goal

最终目标不是输出一堆泛泛建议，而是：

1. 真实理解当前项目。
2. 找到真正影响维护、扩展、安全和数据准确性的问题。
3. 安全修复一批高价值技术债。
4. 留下一份清晰的长期技术债路线图。
5. 所有修改都能通过项目已有验证命令，或者明确指出当前项目缺少验证能力。

---

# Expected Workflow

请按以下流程执行：

## Phase 1: Project Discovery

只读项目，不改代码。

输出：

- 技术栈
- 目录结构
- 核心模块
- 核心业务流程
- 关键风险区域
- 可用脚本命令
- 缺失的工程能力

## Phase 2: Multi-Agent Review

按 `02-multi-agent-roles.md` 中的 Agent 分工审查项目。

每个 Agent 都需要输出具体发现，不能泛泛而谈。

## Phase 3: Prioritization

按 `04-technical-debt-prioritization.md` 对问题排序。

必须区分：

- P0
- P1
- P2
- P3

## Phase 4: Implementation Plan

在改代码前，输出具体执行计划。

## Phase 5: Execute Immediate Fixes

只执行低风险、高价值、可验证的问题。

不要一次性做大规模重构。

## Phase 6: Verify

优先运行项目已有命令，例如：

- npm run lint
- npm run typecheck
- npm run test
- npm run build
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm build
- bun test
- bun run build

请先读取 package.json 再决定实际命令。

## Phase 7: Final Report

按 `07-final-report-format.md` 输出最终报告。

---

# Hard Stop Conditions

如果遇到以下情况，请停止修改代码，只输出分析和建议：

- 不确定业务语义
- 无法验证修改是否安全
- 涉及金额计算但没有测试
- 涉及 Plaid sync 但不清楚现有数据流
- 涉及数据库 migration 但没有明确迁移策略
- 需要大范围架构调整
- 修改会影响用户数据
- 缺少必要环境变量导致无法运行验证

---

# Output Requirement

你的输出必须具体到文件级别。

不要只说：

> improve error handling

而要说：

> `src/app/api/transactions/route.ts` currently returns inconsistent error shapes. This can break frontend assumptions in `TransactionList`. Recommend introducing a shared API error helper.

每个重要问题都要包含：

- 问题描述
- 文件位置
- 影响
- 风险
- 修复建议
- 验证方法
