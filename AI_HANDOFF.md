# AI Handoff Document: Automated Personal Finance Tracker

> 📖 **新接手的 AI Agent 请先读这份文档**，它记录了项目的**真实当前状态**和所有踩过的坑。
>
> 配套文档（均在 `docs/` 目录下）：
> - [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) — 完整系统架构和功能蓝图（原始设计稿）
> - [`docs/TASK_LIST.md`](./docs/TASK_LIST.md) — 各 Phase 的真实完成状态

---

## 🚀 Tech Stack（实际版本）

| 技术 | 版本/配置 |
|---|---|
| **Framework** | Next.js 16.2.6（App Router + Turbopack） |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS + Radix UI（shadcn/ui 风格） |
| **Database / Auth** | Supabase（PostgreSQL + Auth） |
| **Auth 方式** | Email/Password（Supabase Auth） |
| **Bank Sync** | Plaid API — ⚠️ **当前运行在 `production` 环境** |
| **Notion Sync** | Notion REST API v1（2022-06-28）— 绕过官方 SDK，见下方 |
| **iOS 截图/收据解析** | Google Gemini 2.0 Flash（Vision 多模态） |
| **iOS Shortcut API Key** | `ak_...` 随机 token；数据库只保存 SHA-256 hash |

---

## 📂 真实项目结构

> ⚠️ 只列出**实际存在**的文件夹。Components 目录很精简，大部分页面逻辑直接写在各 page.tsx 里。

```
/
├── src/
│   ├── middleware.ts              # Auth 守卫（⚠️ 有弃用警告，见下方）
│   ├── app/
│   │   ├── layout.tsx             # Root layout
│   │   ├── page.tsx               # 根路由 → 重定向到 /dashboard 或 /auth/login
│   │   ├── globals.css            # 全局样式 + CSS 变量（设计系统 token 在这里）
│   │   ├── (dashboard)/           # 路由组（括号表示不影响 URL，共享同一个 layout）
│   │   │   ├── layout.tsx         # Dashboard 布局（含 Sidebar + Header）
│   │   │   ├── dashboard/         # /dashboard 首页概览
│   │   │   ├── transactions/      # /transactions 交易流水列表
│   │   │   ├── accounts/          # /accounts 已连接银行账户
│   │   │   ├── analytics/         # /analytics 图表统计
│   │   │   ├── budgets/           # /budgets 预算管理
│   │   │   └── settings/          # /settings Notion 配置入口（⚠️ 关键）
│   │   ├── auth/login/            # /auth/login 登录页
│   │   └── api/
│   │       ├── plaid/
│   │       │   ├── create-link-token/route.ts
│   │       │   ├── exchange-token/route.ts
│   │       │   └── sync-transactions/route.ts
│   │       ├── notion/
│   │       │   └── sync/route.ts
│   │       ├── receipt/
│   │       │   └── route.ts       # iOS Shortcut 端点（已实现）
│   │       └── settings/
│   │           └── api-keys/route.ts # iOS Shortcut API key 管理
│   ├── components/
│   │   ├── layout/                # Sidebar、Header 等布局组件
│   │   └── accounts/              # Plaid Link 连接银行的组件
│   ├── lib/
│   │   ├── plaid/client.ts        # Plaid 客户端初始化
│   │   ├── notion/
│   │   │   ├── client.ts          # Notion 客户端
│   │   │   └── sync.ts            # ⚠️ 含关键 workaround，见下方
│   │   ├── gemini/
│   │   │   └── receipt-parser.ts  # Gemini Vision 收据解析（已实现）
│   │   ├── supabase/
│   │   │   ├── client.ts          # 浏览器端 Supabase client
│   │   │   └── server.ts          # 服务端 Supabase client
│   │   ├── categories.ts          # Plaid 分类 → 自定义分类的映射逻辑
│   │   └── currency.ts            # 货币格式化工具
│   └── types/
│       └── index.ts               # ⭐ 先读这个！所有数据模型的 TS 类型定义都在这里
├── docs/
│   ├── IMPLEMENTATION_PLAN.md
│   └── TASK_LIST.md
├── AI_HANDOFF.md                  # 本文件
├── .env.local                     # 环境变量（不在 Git 里）
└── .env.example                   # 环境变量模板
```

---

## 🗄️ 实际数据库 Schema（Supabase）

> ⚠️ **远端 Supabase 的真实状态可能落后于本地迁移。**
> 初始部署时只确认了核心 4 张表；`supabase/migrations/002_ios_receipt_api_keys.sql` 已补上 iOS 收据需要的 `receipts` 和 `api_keys`，但仍需在远端执行。

最快了解数据模型的方式：阅读 [`src/types/index.ts`](./src/types/index.ts)。

### `profiles` — 用户配置（对应 `auth.users`）
| 列名 | 类型 | 说明 |
|---|---|---|
| `id` | uuid (PK) | 等于 `auth.users.id` |
| `display_name` | text | 显示名 |
| `default_currency` | text | 默认 'USD' |
| `notion_sync_enabled` | boolean | 是否开启 Notion 同步 |
| `notion_token` | text | Notion Integration Token（用户在 Settings 填写） |
| `notion_database_id` | text | 系统自动写入（首次同步时创建数据库后回写） |

### `plaid_items` — 已连接的银行机构
| 列名 | 类型 | 说明 |
|---|---|---|
| `id` | uuid (PK) | |
| `user_id` | uuid (FK → auth.users) | |
| `access_token` | text | Plaid access_token（⚠️ 生产环境真实密钥） |
| `item_id` | text | Plaid item ID |
| `institution_name` | text | 银行名称（如 "US Bank"） |
| `cursor` | text | `/transactions/sync` 增量游标，记录上次同步位置 |
| `status` | text | 'active' / 'error' / 'login_required' |

### `accounts` — 银行子账户缓存
| 列名 | 类型 | 说明 |
|---|---|---|
| `id` | uuid (PK) | 内部 ID |
| `user_id` | uuid (FK) | |
| `plaid_item_id` | uuid (FK → plaid_items) | 注意：文档里曾写 `item_id`，代码里是 `plaid_item_id` |
| `plaid_account_id` | text | Plaid 的 account_id |
| `name` | text | 账户名 |
| `mask` | text | 卡号后 4 位 |
| `current_balance` | numeric | 当前余额 |
| `available_balance` | numeric | 可用余额 |
| `iso_currency_code` | text | 默认 'USD' |
| `type` | text | 'checking' / 'savings' / 'credit' 等 |
| `subtype` | text | |

### `transactions` — 交易记录（核心）
| 列名 | 类型 | 说明 |
|---|---|---|
| `id` | uuid (PK) | |
| `user_id` | uuid (FK) | |
| `account_id` | uuid (FK → accounts) | |
| `plaid_transaction_id` | text (unique) | Plaid 交易 ID，用于去重，手动记录为 null |
| `amount` | numeric | **⚠️ Plaid 约定：正数=支出，负数=收入** |
| `iso_currency_code` | text | |
| `date` | date | |
| `merchant_name` | text | |
| `description` / `name` | text | 商户名/描述 |
| `payment_channel` | text | 'online' / 'in store' / 'other' |
| `pending` | boolean | |
| `source` | text | 'plaid' / 'manual' / 'receipt' |
| `notion_page_id` | text | 已同步到 Notion 的 page ID（用于增量判断） |
| `tags` | text[] | |
| `notes` | text | |

### `receipts` — iOS Shortcut 上传记录
| 列名 | 类型 | 说明 |
|---|---|---|
| `id` | uuid (PK) | |
| `user_id` | uuid (FK) | |
| `image_url` | text | 当前只保存 data URL 片段/引用，不保存完整图片 |
| `parsed_data` | jsonb | Gemini 解析结果 |
| `status` | text | 'pending' / 'parsed' / 'confirmed' / 'error' |
| `transaction_id` | uuid (FK → transactions) | 自动生成交易后回写 |

### `api_keys` — iOS Shortcut API Key
| 列名 | 类型 | 说明 |
|---|---|---|
| `id` | uuid (PK) | |
| `user_id` | uuid (FK) | |
| `name` | text | 用户可读名称 |
| `key_prefix` | text | UI 展示用前缀 |
| `key_hash` | text | `ak_...` token 的 SHA-256 hash |
| `last_used_at` | timestamptz | 成功调用 `/api/receipt` 时更新 |
| `revoked_at` | timestamptz | 撤销后不再可用 |

> **仍需确认/补齐的表**：`categories`（分类）、`budgets`（预算）。

---

## ⚠️ Critical Quirks & Workarounds（必读）

### 1. Notion SDK Bug — `databases.create` 会丢失所有列定义
**问题**：`@notionhq/client` 的 `notion.databases.create()` 会静默地从请求体中剥离 `properties`，导致在 Notion 里建出一张只有 "Name" 一列的空白表。
**报错现象**：`"Amount is not a property that exists. Date is not a property that exists..."`
**解决方案**：`src/lib/notion/sync.ts` 中的 `createTransactionDatabase()` **完全绕过 SDK**，改用原生 `fetch` 直接 POST 到 `https://api.notion.com/v1/databases`。
**❌ 禁止**：不要把这个函数改回使用 `notion.databases.create()`，除非确认 Notion 官方已修复。

### 2. Notion 同步是单向增量的
- **方向**：Supabase → Notion（单向推送，Notion 里的修改不会同步回来）
- **增量判断**：通过 `transactions.notion_page_id` 字段。若为 null → 创建新页面；若有值 → 更新现有页面
- **限流**：使用 `async-sema` 控制约 3 req/s，避免触发 Notion 限流
- **重置方法**：如需重新建表，在 Supabase Dashboard 里把该用户的 `profiles.notion_database_id` 清空为 null，然后去 Notion 里删掉旧的数据库，再次 Force Sync 时会自动重建

### 3. Plaid 同步是增量的（基于 cursor）
- 每次调用 `/api/plaid/sync-transactions`，会用 `plaid_items.cursor` 作为起点，只拉取上次同步以来的新/改/删交易
- `cursor` 会在每次成功同步后自动更新写回 `plaid_items` 表
- **⚠️ 不要随意清空 `plaid_items` 表**：已连接的真实银行（如 US Bank）的 production `access_token` 存在这里，删了需要用户重新走 Plaid Link 授权流程

### 4. Plaid Production — 大银行 OAuth 限制
**背景**：已于 2026-05-20 从 `sandbox` 切换为 `production`。
**问题**：Chase、Amex、Capital One 等大银行要求在 Plaid Dashboard 额外注册 OAuth 应用，未注册的话 Plaid Link 在手机验证码步骤后会弹出 "Something went wrong: Internal error occurred"。
**结论**：这是 Plaid Dashboard 配置问题，不是代码 bug。US Bank 可正常连接。

### 5. Notion Token 存在数据库里，不是环境变量
Notion Token 由**用户在 `/settings` 页面手动填写**，存入 Supabase `profiles.notion_token`。
后端调用 Notion API 前，会先从数据库读取当前用户的 token。`NOTION_TOKEN` **不在** `.env.local` 里。

### 6. middleware.ts 弃用警告
服务器日志会持续出现：
`⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.`
这是因为 `src/middleware.ts` 在这个 Next.js 版本里应该改名为 `src/proxy.ts`。功能正常，但警告一直存在。

### 7. iOS Capture / Receipt API 依赖的迁移
`src/app/api/receipt/route.ts` 和 `src/lib/gemini/receipt-parser.ts` 代码已实现。Phase 6 的补充迁移在 `supabase/migrations/002_ios_receipt_api_keys.sql`，包含 `receipts` 表和 `api_keys` 表。若远端 Supabase 还没运行这条迁移，iOS Shortcut 仍会报数据库错误。

该 API 现在不依赖 Plaid：识别到收据照片、支付截图、银行/信用卡交易截图后，会自动创建/复用一个 `accounts.name = 'iOS Capture'` 的手动 cash 账户，并向 `transactions` 插入一笔 `source = 'receipt'` 的记录。

### 8. iOS Shortcut API Key
`/settings` 页面可以生成、复制、撤销 `ak_...` API key。完整 key 只显示一次，数据库 `api_keys.key_hash` 只保存 SHA-256 hash；`/api/receipt` 会用 service role 查 hash 并更新 `last_used_at`。不要恢复成“user_id 当 key”的旧方案。

---

## 🔑 环境变量（`.env.local`）

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://wzzdylcwfitgrrugxzxy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Plaid — 当前: production 环境
PLAID_CLIENT_ID=6a0d5284a0443c000dedf2a7
PLAID_SECRET=...     # Production Secret
PLAID_ENV=production

# Gemini（收据解析，已用于 /api/receipt）
GEMINI_API_KEY=...
```

> **不在 `.env.local` 里的**：`NOTION_TOKEN`（存在 Supabase 数据库里）

---

## 🏃 本地运行

```bash
npm install
npm run dev
# → http://localhost:3000
# 未登录会自动跳转到 /auth/login
# 登录后跳转到 /dashboard
```

---

## 🎯 未完成 / 已知问题（按优先级）

| 优先级 | 类型 | 功能/问题 | 说明 |
|---|---|---|---|
| 🔴 | Bug | Sidebar CSS 问题 | 侧边栏在某些宽度下有对齐问题 |
| 🔴 | Bug | Dashboard 显示 placeholder | 部分统计卡片未接入真实数据 |
| 🔴 | Ops | 运行 Phase 6 迁移 | 远端 Supabase 需执行 `002_ios_receipt_api_keys.sql` |
| 🔴 | Bug | `middleware.ts` 弃用警告 | 需改名为 `proxy.ts` |
| 🟡 | Feature | AI 智能分类 | 用 Gemini 优化 Plaid 商户名和分类后再推 Notion |
| 🟡 | Feature | Plaid Webhooks | 当前需手动点击触发同步，应改为 webhook 实时推送 |
| 🟢 | Feature | Budget 预算逻辑 | 页面已有 UI，但无真实数据逻辑 |
| 🟢 | Feature | Analytics 图表完善 | 图表需对接真实交易数据 |
| 🟢 | Feature | Chase / Amex OAuth 注册 | 在 Plaid Dashboard 申请以解锁大银行连接 |

---

## 📋 已实现功能清单

- ✅ Email/Password 注册登录（Supabase Auth）
- ✅ Plaid Link 连接银行（Production 环境）
- ✅ Plaid `/transactions/sync` 增量拉取交易
- ✅ Transactions 列表页（带筛选/搜索）
- ✅ Accounts 账户管理页
- ✅ Analytics 图表页（基础版）
- ✅ Settings 页面（Notion Token 配置入口）
- ✅ Settings 页面生成/撤销 iOS Shortcut `ak_...` API key
- ✅ Notion 数据库自动创建（使用原生 fetch 绕过 SDK bug）
- ✅ Notion 增量同步（Force Sync 按钮）
- ✅ Gemini Vision iOS 截图/收据解析 API（依赖 `002_ios_receipt_api_keys.sql`）

Good luck! 🚀
