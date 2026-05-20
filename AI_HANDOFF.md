# AI Handoff — Accountant

> 📖 **新接手的 AI Agent 请先读这份文档**，记录了项目的**真实当前状态**和所有踩过的坑。

---

## 当前状态总览

项目功能已基本实现并部署在 Vercel Production。核心功能全部可用，剩余均为体验优化或待配置项。

**已完成的功能**：
- ✅ Email/Password 注册登录（Supabase Auth）
- ✅ Plaid Link 连接银行（**Production 环境**，非 Sandbox）
- ✅ Plaid `/transactions/sync` 增量拉取交易（基于 cursor）
- ✅ Transactions 列表页（带筛选/搜索）
- ✅ Accounts / Analytics / Budgets 页面（UI 已有）
- ✅ Settings 页面（Notion Token 配置 + iOS API Key 管理）
- ✅ Notion 数据库自动创建 + 增量同步（Force Sync 按钮）
- ✅ iOS 截图/收据解析 API（`/api/receipt`，Gemini Vision）

**待处理**：

| 优先级 | 类型 | 说明 |
|---|---|---|
| 🟡 | Feature | Plaid Webhooks（目前靠手动点击同步） |
| 🟡 | Feature | AI 智能分类（Gemini 优化 Plaid 商户名后再推 Notion） |
| 🟢 | Feature | Budget 预算逻辑（页面有 UI，无数据） |
| 🟢 | Feature | Analytics 图表接入真实数据 |
| 🟢 | Config | Chase / Amex OAuth 注册（Plaid Dashboard 配置） |

---

## Tech Stack（实际版本）

| 技术 | 版本/配置 |
|---|---|
| **Framework** | Next.js (App Router + Turbopack) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS + Radix UI（shadcn/ui 风格） |
| **Database / Auth** | Supabase（PostgreSQL + Auth） |
| **Auth 方式** | Email/Password（Supabase Auth） |
| **Bank Sync** | Plaid API — ⚠️ **当前运行在 `production` 环境** |
| **Notion Sync** | Notion REST API v1（2022-06-28）— 绕过官方 SDK，见下方 |
| **iOS 截图解析** | Google Gemini 2.0 Flash（Vision 多模态） |
| **iOS Shortcut API Key** | `ak_...` 随机 token；数据库只保存 SHA-256 hash |

---

## 项目结构

> ⚠️ 只列出**实际存在**的文件夹。大部分页面逻辑直接写在各 `page.tsx` 里。

```
/
├── src/
│   ├── proxy.ts                   # Auth 守卫（Next.js 中间件）
│   ├── app/
│   │   ├── layout.tsx             # Root layout
│   │   ├── page.tsx               # 根路由 → 重定向到 /dashboard 或 /auth/login
│   │   ├── globals.css            # 全局样式 + CSS 变量（设计系统 token 在这里）
│   │   ├── (dashboard)/           # 路由组（共享 Dashboard 布局）
│   │   │   ├── layout.tsx         # Dashboard 布局（含 Sidebar + Header）
│   │   │   ├── dashboard/         # /dashboard 首页概览
│   │   │   ├── transactions/      # /transactions 交易流水列表
│   │   │   ├── accounts/          # /accounts 已连接银行账户
│   │   │   ├── analytics/         # /analytics 图表统计
│   │   │   ├── budgets/           # /budgets 预算管理
│   │   │   └── settings/          # /settings Notion 配置 + iOS API Key（⚠️ 关键）
│   │   ├── auth/login/            # /auth/login 登录页
│   │   └── api/
│   │       ├── plaid/
│   │       │   ├── create-link-token/route.ts
│   │       │   ├── exchange-token/route.ts
│   │       │   └── sync-transactions/route.ts
│   │       ├── notion/sync/route.ts
│   │       ├── receipt/route.ts       # iOS Shortcut 端点（已实现）
│   │       └── settings/api-keys/route.ts
│   ├── components/
│   │   ├── layout/                # Sidebar、Header
│   │   └── accounts/              # Plaid Link 连接银行的组件
│   ├── lib/
│   │   ├── plaid/client.ts
│   │   ├── notion/
│   │   │   ├── client.ts
│   │   │   └── sync.ts            # ⚠️ 含关键 workaround，见下方
│   │   ├── gemini/receipt-parser.ts
│   │   ├── supabase/
│   │   │   ├── client.ts          # 浏览器端 client
│   │   │   └── server.ts          # 服务端 client
│   │   ├── categories.ts          # Plaid 分类 → 自定义分类映射
│   │   └── currency.ts            # 货币格式化工具
│   └── types/index.ts             # ⭐ 先读这个！所有数据模型的 TS 类型定义
├── supabase/migrations/
│   ├── 001_initial_schema.sql     # 核心 4 张表
│   └── 002_ios_receipt_api_keys.sql # receipts + api_keys 表
├── docs/
│   ├── ARCHITECTURE.md            # 系统架构、Schema 参考
│   └── ios-shortcut-guide.md      # iOS 快捷指令配置指南
├── AI_HANDOFF.md                  # 本文件
├── .env.local                     # 环境变量（不在 Git 里）
└── .env.example                   # 环境变量模板
```

---

## 环境变量

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://wzzdylcwfitgrrugxzxy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Plaid — 当前: production 环境
PLAID_CLIENT_ID=6a0d5284a0443c000dedf2a7
PLAID_SECRET=...     # Production Secret
PLAID_ENV=production

# Gemini（收据解析）
GEMINI_API_KEY=...
```

> **不在 `.env.local` 里的**：`NOTION_TOKEN`（存在 Supabase `profiles.notion_token`，由用户在 Settings 填写）

---

## ⚠️ 关键 Quirks & Workarounds

### 1. Notion SDK Bug — `databases.create` 丢失所有列定义
**问题**：`@notionhq/client` 的 `notion.databases.create()` 会静默剥离 `properties`，建出只有 "Name" 一列的空表。  
**报错**：`"Amount is not a property that exists. Date is not a property that exists..."`  
**解决**：`src/lib/notion/sync.ts` 中的 `createTransactionDatabase()` **完全绕过 SDK**，改用原生 `fetch` 直接 POST 到 `https://api.notion.com/v1/databases`。  
**❌ 禁止**：不要把这个函数改回使用 `notion.databases.create()`。

### 2. Notion 同步策略
- **方向**：Supabase → Notion（单向推送，Notion 里的修改不会同步回来）
- **增量判断**：`transactions.notion_page_id` 为 null → 创建；有值 → 更新
- **限流**：`async-sema`，约 3 req/s
- **重置方法**：在 Supabase Dashboard 把该用户 `profiles.notion_database_id` 清空为 null，在 Notion 删掉旧数据库，再 Force Sync 即可重建

### 3. Plaid 同步（基于 cursor）
- 每次调用 `/api/plaid/sync-transactions`，用 `plaid_items.cursor` 作增量起点
- ⚠️ **不要随意清空 `plaid_items` 表**：Production `access_token` 存在这里，删了需要用户重新 Plaid Link 授权

### 4. Plaid Production — 大银行 OAuth 限制
Chase、Amex、Capital One 等需在 Plaid Dashboard 额外注册 OAuth 应用；US Bank 可正常连接。

### 5. Notion Token 存数据库，不是环境变量
用户在 `/settings` 页填写，存入 `profiles.notion_token`。后端调 Notion API 前从数据库读取。

### 6. Auth 中间件文件名
`src/proxy.ts`（已从 `middleware.ts` 改名）是 Next.js Auth 守卫。

### 7. iOS Capture API
`src/app/api/receipt/route.ts` 不依赖 Plaid：识别到图片后，自动创建/复用 `accounts.name = 'iOS Capture'` 的手动账户，写入 `source = 'receipt'` 的交易记录。数据库依赖（`receipts`、`api_keys` 表）已由 `002_ios_receipt_api_keys.sql` 迁移完成。

### 8. iOS Shortcut API Key
`/settings` 页可生成、复制、撤销 `ak_...` API key。完整 key 只显示一次，数据库只保存 SHA-256 hash。`/api/receipt` 用 service role 查 hash 并更新 `last_used_at`。

---

## 本地运行

```bash
npm install
npm run dev
# → http://localhost:3000
# 未登录自动跳转 /auth/login，登录后跳转 /dashboard
```

---

Good luck! 🚀
