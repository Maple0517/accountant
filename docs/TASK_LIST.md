# Accountant — 任务清单

## Phase 1: Environment & Tooling Setup
- [x] Create Next.js 15 project (App Router)
- [x] Configure TailwindCSS / global CSS design system
- [x] Set up Supabase clients (client & server)
- [x] Define TypeScript interfaces (matching Supabase schema)
- [x] Initialize Git repository
- [x] Create `.env.example`

## Phase 2: Database & Authentication
- [x] Write and run Supabase SQL migrations (tables, RLS policies, triggers)
- [x] Setup Next.js middleware for session management
- [x] Build `/auth/login` page (Email/Password)
- [x] Implement OAuth callback route
- [x] Build root layout with Sidebar and Header navigation
- [x] Build `/dashboard` landing page

## Phase 3: Plaid Integration (Bank Sync)
- [x] Configure Plaid SDK client
- [x] Create `/api/plaid/create-link-token` endpoint
- [x] Build `PlaidLinkButton` UI component
- [x] Create `/api/plaid/exchange-token` endpoint (save items/accounts)
- [x] Create `/api/plaid/sync-transactions` endpoint (sync logic)
- [x] Map Plaid categories to custom app categories
- [x] Build `/accounts` page UI with Account cards
- [x] Switch from Plaid Sandbox → Production environment
- [ ] 分类映射精细化 (PFC → custom categories)

## Phase 4: Web UI
- [x] Dashboard 页面 (消费概览)
- [x] Transactions 列表页 (筛选/搜索)
- [x] Analytics 图表页 (饼图/折线图/柱状图)
- [x] Accounts 账户管理页
- [x] Budgets 预算页
- [x] UI 组件 (Card, Button, Badge, Modal, CurrencyDisplay)
- [ ] Sidebar CSS 修复 (某些宽度下对齐有问题)
- [ ] Dashboard 真实数据接入 (部分卡片还是 placeholder)

## Phase 5: Notion 同步
- [x] Notion client 配置
- [x] 同步逻辑 (增量推送)
- [x] Settings 页面 (Notion 配置入口)
- [x] 自动同步触发器
- [x] **修复 Notion SDK `databases.create` bug** (绕过 SDK 使用原生 fetch)
- [ ] AI 智能分类 (用 Gemini 优化商户名和分类后再推送 Notion)
- [ ] Plaid Webhooks 实时同步 (替代当前的手动同步)

## Phase 6: iOS Shortcut + 截图记账（未实现）
- [ ] Receipt API 端点 (`/api/receipt/route.ts`)
- [ ] Gemini Vision 收据解析 (`src/lib/gemini/receipt-parser.ts`)
- [ ] iOS Shortcut 配置指南
