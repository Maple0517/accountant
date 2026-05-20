# AI Handoff Document: Automated Personal Finance Tracker

> 📖 **新接手的 AI Agent 请先读这份文档**。这里记录了项目的真实当前状态、所有踩过的坑和绕过方案，能帮你避免重复犯同样的错误。
>
> 相关文档：
> - [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) — 完整系统架构和功能蓝图
> - [`docs/TASK_LIST.md`](./docs/TASK_LIST.md) — 各 Phase 的完成状态

---

## 🚀 Tech Stack（实际使用的版本）

| 技术 | 版本/配置 |
|---|---|
| **Framework** | Next.js 16.2.6 (App Router, Turbopack) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS + Radix UI (shadcn/ui-like) |
| **Database** | Supabase (PostgreSQL) |
| **Auth** | Supabase Auth (Email/Password) |
| **Bank Sync** | Plaid API — **当前: `production` 环境** |
| **Notion Sync** | Notion API v1 (2022-06-28) — 绕过官方 SDK，见下方 |

---

## 📂 实际项目结构

```
src/
├── app/
│   ├── (dashboard)/        # 需要登录的页面组 (layout.tsx 含 Sidebar+Header)
│   │   ├── dashboard/      # 首页概览
│   │   ├── transactions/   # 交易流水列表
│   │   ├── accounts/       # 已连接银行账户
│   │   ├── analytics/      # 图表统计
│   │   ├── budgets/        # 预算管理
│   │   └── settings/       # 设置 (Notion 配置入口在这里)
│   ├── auth/login/         # 登录页
│   └── api/
│       ├── plaid/
│       │   ├── create-link-token/route.ts
│       │   ├── exchange-token/route.ts
│       │   └── sync-transactions/route.ts
│       └── notion/
│           └── sync/route.ts
├── components/
│   ├── layout/Sidebar.tsx
│   └── ...
└── lib/
    ├── plaid/client.ts
    ├── notion/
    │   ├── client.ts
    │   └── sync.ts          # ⚠️ 有关键 workaround，见下方
    └── supabase/
        ├── client.ts        # 浏览器端
        └── server.ts        # 服务端
```

---

## 🗄️ 实际数据库 Schema（Supabase）

> ⚠️ **注意**：Implementation Plan 里规划了7张表，但目前实际只创建并运行了以下4张。

### `profiles` — 用户配置
| 列名 | 类型 | 说明 |
|---|---|---|
| `id` | uuid (PK) | 对应 `auth.users.id` |
| `notion_token` | text | Notion Integration Token（用户填写，非环境变量） |
| `notion_database_id` | text | 已创建的 Notion 数据库 ID（系统自动写入） |
| `notion_sync_enabled` | boolean | 是否开启同步 |

### `plaid_items` — 已连接的银行
| 列名 | 类型 | 说明 |
|---|---|---|
| `id` | uuid (PK) | |
| `user_id` | uuid (FK) | |
| `access_token` | text | Plaid access token |
| `item_id` | text | Plaid item ID |
| `institution_name` | text | 银行名称 |
| `cursor` | text | `/transactions/sync` 的增量游标 |

### `accounts` — 银行子账户
| 列名 | 类型 | 说明 |
|---|---|---|
| `account_id` | text | Plaid account ID |
| `name` / `mask` | text | 账户名 / 卡号后4位 |
| `current_balance` / `available_balance` | numeric | 余额 |
| `type` / `subtype` | text | checking / savings / credit 等 |
| `iso_currency_code` | text | 默认 USD |
| `item_id` | uuid (FK → plaid_items) | |

### `transactions` — 交易记录（核心表）
| 列名 | 类型 | 说明 |
|---|---|---|
| `plaid_transaction_id` | text (unique) | Plaid 交易 ID，用于去重 |
| `account_id` | uuid (FK) | |
| `name` | text | 商户名 |
| `amount` | numeric | 正数=支出，负数=收入（Plaid 约定） |
| `date` | date | |
| `category` | text | 分类名称 |
| `merchant_name` | text | |
| `pending` | boolean | |

> **尚未创建的表**：`categories`, `budgets`, `receipts`（见 TASK_LIST.md Phase 6）

---

## ⚠️ Critical Quirks & Workarounds（必读）

### 1. Notion SDK Bug — `databases.create` 会丢失 `properties`
**问题**：`@notionhq/client` 的 `notion.databases.create()` 会静默地把 `properties`（表头定义）从请求体中剥离，导致在 Notion 里建出一张只有 "Name" 列的空白数据库。  
**现象**：同步时报错 `"Amount is not a property that exists. Date is not a property that exists..."`  
**解决方案**：`src/lib/notion/sync.ts` 中的 `createTransactionDatabase()` 函数**完全绕过 SDK**，改用原生 `fetch` 直接调用 `https://api.notion.com/v1/databases`（POST）。  
**警告**：❌ 不要把这个函数改回使用 `notion.databases.create()`，除非 Notion 官方修复了这个 bug。

### 2. Plaid Production — 大银行 OAuth 问题
**背景**：已从 `sandbox` 切换为 `production` 环境（2026-05-20 完成）。  
**问题**：Chase、Amex、Capital One 等大银行在生产环境需要额外的 OAuth 应用注册和 Plaid 人工审批，否则 Plaid Link 会在手机验证码之后弹出 "Internal error occurred"。  
**结论**：这是 Plaid Dashboard 配置问题，不是代码问题。US Bank 等不需要 OAuth 的银行可以正常连接。

### 3. Notion Token 的存储位置
Notion Token 不在 `.env.local` 里，而是由**用户在 Settings 页面填写**，然后存入 Supabase 的 `profiles` 表。  
后端 API 在需要调用 Notion 时，会先从数据库读取该用户的 `notion_token`。

### 4. `styled-jsx` 在 Server Component 中报错
项目中 `(dashboard)/layout.tsx` 曾出现过 `'styled-jsx' cannot be imported from a Server Component` 的 Build Error。已解决，确保该文件有 `'use client'` 标记或不使用 styled-jsx。

---

## 🔑 环境变量 (`.env.local`)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Plaid (当前: production)
PLAID_CLIENT_ID=...
PLAID_SECRET=...          # 使用 Production Secret
PLAID_ENV=production

# Gemini (收据识别功能，Phase 6)
GEMINI_API_KEY=...
```

> **注意**：`NOTION_TOKEN` **不在** `.env.local` 里，是每个用户在 `/settings` 页面自行配置的。

---

## 🏃 本地运行

```bash
npm install
npm run dev   # http://localhost:3000
```

---

## 🎯 未完成的功能（接下来可以做）

| 优先级 | 功能 | 说明 |
|---|---|---|
| 🔴 高 | Sidebar CSS 修复 | 侧边栏在某些宽度下有对齐问题 |
| 🔴 高 | Dashboard 真实数据 | 部分统计卡片还是 placeholder |
| 🟡 中 | AI 智能分类 | 用 Gemini 自动优化 Plaid 的商户名和分类 |
| 🟡 中 | Plaid Webhooks | 目前是手动触发同步，应改为实时 webhook 推送 |
| 🟢 低 | iOS Shortcut 收据识别 | Phase 6，Gemini Vision 解析小票 |
| 🟢 低 | Budget 预算功能 | 页面已有但无真实数据逻辑 |
| 🟢 低 | Analytics 图表完善 | 图表数据对接真实交易 |

---

Good luck! 🚀 有任何关于这个项目的问题，可以从 `docs/IMPLEMENTATION_PLAN.md` 找到系统设计的完整背景。
