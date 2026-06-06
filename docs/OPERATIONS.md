# Operations — Accountant

运行、部署、配置和排障手册。架构看 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

## 1. 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开：<http://localhost:3000>

常用命令：

```bash
npm run typecheck
npm run lint
npm run pretest
npm test
npm run build
```

测试项目使用 TypeScript 预编译：

```bash
npm run pretest
node --import ./test/register-alias.mjs --test .tmp-tests/**/*.test.js
```

## 2. 环境变量

以 [`.env.example`](../.env.example) 为准。

### Supabase

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- Browser client 只能用 anon key。
- Service role 只允许在服务端 route/helper 使用。
- 不要在客户端 payload、日志、文档里泄露 service role。

### Plaid

```env
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=production
PLAID_WEBHOOK_URL=https://your-domain.com/api/plaid/webhook?secret=...
PLAID_WEBHOOK_SECRET=
CRON_SECRET=
```

- `PLAID_ENV` 本地可用 sandbox/development；生产按 Vercel 配置。
- `PLAID_WEBHOOK_SECRET` 支持 query `?secret=...` 或 header `x-plaid-webhook-secret`。
- `CRON_SECRET` 用于 Vercel Cron `Authorization: Bearer <secret>`。

### Gemini

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_CLASSIFIER_RPM_LIMIT=15
GEMINI_CLASSIFIER_TPM_LIMIT=250000
GEMINI_CLASSIFIER_RPD_LIMIT=500
GEMINI_CLASSIFIER_BATCH_SIZE=20
GEMINI_CLASSIFIER_MAX_REQUESTS_PER_RUN=5
GEMINI_CLASSIFIER_MAX_INPUT_TOKENS=200000
```

Gemini 用于 receipt parser 和 Plaid fallback 分类优化。

### Notion

Notion token 通常由用户在 `/settings` 配置，保存到 `profiles.notion_token`。`.env.example` 中的 `NOTION_TOKEN` 只可作为本地/历史兼容配置，不应替代用户 profile 配置。

## 3. 部署

- App：Vercel。
- Database/Auth：Supabase。
- Cron：`vercel.json`。

当前 cron：

```json
{
  "crons": [
    { "path": "/api/cron/plaid-sync", "schedule": "0 8 * * *" },
    { "path": "/api/cron/notion-outbox", "schedule": "0 9 * * *" }
  ]
}
```

生产部署前至少确认：

- Vercel env 有 Supabase/Plaid/Gemini/Cron 变量。
- Supabase migrations 已应用。
- Plaid Dashboard webhook URL 指向生产域名。
- 大银行 OAuth 机构按 Plaid Dashboard 要求配置。

## 4. Supabase migrations

迁移目录：`supabase/migrations/`。

原则：

- 所有 schema/RPC/RLS/index 变更必须进 migration。
- 高风险迁移先读现有 migrations，避免重复创建约束/索引/RPC 签名。
- Soft-delete、archive、split guard、service-role RPC 是高风险区域。
- 迁移后需要验证真实 schema，不要只看本地 SQL。

## 5. 常见操作

### 手动启动开发服务器

```bash
npm run dev
```

### 构建验证

```bash
npm run typecheck
npm test
npm run build
```

### 检查 route bundle stats

构建后看：

```bash
.next/diagnostics/route-bundle-stats.json
```

### 检查 iOS receipt API 未授权状态

```bash
curl -i https://accountant-rose.vercel.app/api/receipt
```

实际上传必须 POST multipart form，并带 `api_key` 或相应 Authorization 方案。

### 检查 Scriptable widget auth

```bash
curl -i "https://accountant-rose.vercel.app/api/widget/recent-transactions?limit=7"
```

未登录且无 API key 时应返回 unauthorized。带 key：

```bash
curl -H "Authorization: Bearer ak_xxx" \
  "https://accountant-rose.vercel.app/api/widget/recent-transactions?limit=7"
```

不要把真实 `ak_...` 写入 shell history 截图或文档。

## 6. 故障排查

### Plaid 账户删除后卡片还在

优先确认是不是 delete-history archive 语义漏了：

- `accounts.archived_at` 是否设置。
- `accounts.archived_reason` 是否为 delete-history 相关原因。
- 关联 transactions 是否 soft-deleted。
- Dashboard/Accounts API 是否过滤 archived account。

不要用 hard delete 作为默认修复。

### Transactions count 或 saved views 慢

优先看：

- `src/lib/transactions/list-filters.ts`
- `src/app/api/transactions/view-counts/route.ts`
- migration 中的 `get_transaction_list_counts(...)`
- `transactions_tags_gin_idx`

不要重新引入多个 repeated exact count。

### Dashboard 数字和 Budgets/Analytics 不一致

优先确认三处是否都使用统一语义：

- `isEffectiveTransaction`
- `getBudgetDate`
- `getBudgetSemanticAmounts`
- pending / excluded / split parent / hidden / deleted 是否一致

### Notion database 缺列

不要改 SDK。检查 `src/lib/notion/sync.ts` 的 raw fetch database create 路径是否仍在。

### iOS Capture 创建重复交易

检查：

- Shortcut 是否传 `idempotency_key`。
- `receipts_user_idempotency_key_uidx` 是否存在。
- API 是否复用同一次 idempotency result。

### AI Pending 一直不降

检查：

- tags 是否仍包含 `classification:ai-pending` 或 `classification:plaid-fallback`。
- `ai_classification_jobs` / `ai_classification_job_items` 状态。
- Gemini rate limit env。
- `/api/plaid/ai-classification-jobs/process` 错误摘要。

## 7. 安全清单

提交/回报前确认没有泄露：

- Plaid access token / item token
- Supabase service role
- Notion token
- raw `ak_...` API key
- cookies/session
- 完整用户交易明细
- Gemini API key

日志和最终回复只写必要路径、命令、状态码、错误摘要。
