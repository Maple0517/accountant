# AI Handoff — Accountant

新 Agent/Codex 接手先读这份。它记录当前仓库真实工作约定、危险区和优先验证路径；长期架构见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)，运行部署见 [`docs/OPERATIONS.md`](./docs/OPERATIONS.md)。

## 当前产品事实

- 这是一个 Next.js 全栈个人财务应用，生产部署在 Vercel，数据在 Supabase。
- Plaid 当前用于生产银行连接；部分大银行 OAuth 仍依赖 Plaid Dashboard 侧配置。
- 交易同步以 Plaid `/transactions/sync` cursor 为准；手动同步、webhook、cron 应复用同一套同步逻辑。
- Transactions 是核心工作台：分类、AI pending、退款、转账、split、隐藏/删除、saved views 都围绕它展开。
- Dashboard 是行动优先 cockpit，不应重新变成等权重卡片堆。
- Analytics 当前方向是 review/insights；若只剩图表，它就不值得做一级入口。
- Budgets 是高风险领域，必须走 `src/modules/budget/` 分层。
- iOS Capture 与 Scriptable Widget 都复用 `ak_...` API key，数据库只保存 hash。
- Notion Sync 是 Supabase -> Notion 单向同步，不从 Notion 反写。

## 先看哪些文件

| 目的 | 文件 |
|---|---|
| 数据模型 | `src/types/index.ts` |
| 有效交易/报表语义 | `src/lib/transactions/effective.ts` |
| 交易 treatment 规范化 | `src/lib/transactions/treatment.ts` |
| 交易列表筛选/saved views | `src/lib/transactions/list-filters.ts` |
| 复核语义 | `src/lib/transactions/review.ts` |
| Plaid 同步 | `src/lib/plaid/transactions-sync.ts` |
| AI 分类 | `src/lib/plaid/classification.ts`, `src/lib/plaid/ai-classification-queue.ts` |
| Budget | `src/modules/budget/` |
| Analytics | `src/modules/analytics/`, `src/app/(dashboard)/analytics/page.tsx` |
| Dashboard | `src/app/api/dashboard/route.ts`, `src/app/(dashboard)/dashboard/page.tsx` |
| Notion | `src/lib/notion/sync.ts` |
| Receipt/iOS | `src/app/api/receipt/route.ts`, `src/app/api/settings/api-keys/route.ts` |
| Widget | `src/app/api/widget/recent-transactions/route.ts`, `docs/scriptable/recent-transactions-widget.js` |

## 不要踩的坑

### Plaid

- 不要硬删 `plaid_items`、`accounts` 或生产 token。
- delete-history 的正确语义：archive account + soft-delete associated transactions；不要变成 hard delete。
- `ITEM_NOT_FOUND` 等历史删除场景要保持幂等。
- 新/旧 item 的 webhook 注册逻辑不要分叉；手动同步可补注册 webhook。
- Vercel Cron 调 `/api/cron/plaid-sync` 时需要 `Authorization: Bearer <CRON_SECRET>`。

### 交易和报表

- 报表/预算只统计有效交易：`deleted_at IS NULL`、`is_hidden_from_reports=false`、`split_role != parent`。
- Budget 还要排除 pending 和 excluded category。
- `needs_review` 不是单纯 pending；它包含未分类、AI pending、未链接退款、需处理转账等。
- Split parent 只保留原始交易/对账语义；实际报表看 split children。
- 退款、reimbursement、income、transfer、excluded 不能只靠金额正负判断。

### Notion

- `src/lib/notion/sync.ts` 创建 Notion database 必须用原生 `fetch`。不要改回官方 SDK 的 `databases.create()`。
- Notion token 存 `profiles.notion_token`；Settings route 负责保存/展示 masked 状态。
- Notion sync outbox 用于 split/异步同步；不要绕过已有队列语义做重复同步。

### Auth / Next.js

- 这个 Next.js 版本不是训练集中常见版本；改 routing/proxy/middleware 前读 `node_modules/next/dist/docs/`。
- Auth 相关要同时看 route protection、server client、browser client、RLS/service-role 边界。

### 隐私和日志

- 不要输出 Plaid access token、Supabase service role、Notion token、raw `ak_...` key、用户完整交易明细。
- 调试只保留必要 request id、状态码、错误摘要和本地路径。

## 推荐验证路径

| 改动类型 | 最小验证 |
|---|---|
| 文档 | 链接/路径 sanity + `git diff --check` |
| 类型/API/UI | `npm run typecheck` + 相关测试 |
| 交易筛选/复核 | `npm run pretest && npm test -- <focused>` 或相关 node test |
| Budget/Analytics/Dashboard | 相关 service test + typecheck |
| Plaid/账户删除 | focused tests + 真实数据只读核对，必要时查日志 |
| Next routing/auth | 本地 Next 文档 + proxy/auth tests + typecheck |
| 生产修复 | 验证 -> commit -> push/merge/deploy，保留证据 |

## 文档维护规则

- README 只写入口和状态总览。
- 这份 handoff 只保留当前事实、坑和操作约束。
- 架构细节放 `docs/ARCHITECTURE.md`。
- 运维/环境/故障排查放 `docs/OPERATIONS.md`。
- 过期 implementation plan 不要长期留在 docs；要么执行，要么删。
