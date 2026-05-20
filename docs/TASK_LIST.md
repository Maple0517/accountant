# Accountant — 任务清单（真实状态）

> 最后更新：2026-05-20

## Phase 1: 基础设施 ✅
- [x] 创建 Next.js 16 项目（App Router + Turbopack）
- [x] 配置 Tailwind CSS + CSS Variables 设计系统
- [x] 配置 Supabase 客户端（浏览器端 + 服务端）
- [x] 定义 TypeScript 类型（`src/types/index.ts`）
- [x] 初始化 Git 仓库 + `.env.example`

## Phase 2: 数据库 & 认证 ✅
- [x] Supabase SQL 建表（`profiles`, `plaid_items`, `accounts`, `transactions`）
- [x] Row Level Security（RLS）策略
- [x] Next.js Auth 中间件（`src/middleware.ts`）
  - [ ] ⚠️ 弃用警告：需改名为 `src/proxy.ts`
- [x] `/auth/login` 登录页（Email/Password）
- [x] Auth callback 路由
- [x] Dashboard 根布局（Sidebar + Header）

## Phase 3: Plaid 银行同步 ✅
- [x] Plaid SDK 客户端配置（`src/lib/plaid/client.ts`）
- [x] `POST /api/plaid/create-link-token` 端点
- [x] Plaid Link 前端组件（`src/components/accounts/`）
- [x] `POST /api/plaid/exchange-token` 端点（交换并保存 access_token）
- [x] `POST /api/plaid/sync-transactions` 端点（增量 cursor 同步）
- [x] Plaid PFC 分类映射（`src/lib/categories.ts`）
- [x] `/accounts` 账户管理页
- [x] 从 Sandbox 切换到 **Production** 环境（2026-05-20）
- [ ] Plaid Webhooks 实时推送（目前靠手动触发同步）
- [ ] Chase / Amex OAuth 应用注册（Plaid Dashboard 配置）

## Phase 4: Web UI ✅（部分完成）
- [x] `/dashboard` 首页概览
  - [ ] ⚠️ 部分统计卡片仍显示 placeholder 数据
- [x] `/transactions` 交易列表（含搜索/筛选）
- [x] `/analytics` 图表页（基础版）
  - [ ] 图表数据需进一步对接真实交易
- [x] `/accounts` 账户管理页
- [x] `/budgets` 预算页（UI 已有，无真实数据逻辑）
- [ ] ⚠️ Sidebar CSS 问题（某些宽度下对齐异常）

## Phase 5: Notion 同步 ✅
- [x] Notion 客户端（`src/lib/notion/client.ts`）
- [x] 同步逻辑（`src/lib/notion/sync.ts`）
  - [x] **⚠️ 关键 workaround**：`createTransactionDatabase()` 绕过 SDK，使用原生 fetch 建表（SDK bug 会丢失 properties）
- [x] `/settings` 页面（Notion Token 配置 + Force Sync 按钮）
- [x] 增量同步（通过 `notion_page_id` 字段判断是否已同步）
- [x] 限流（`async-sema`，~3 req/s）
- [ ] AI 辅助分类（Gemini 优化商户名后再推送 Notion）
- [ ] 自动触发（目前靠手动点击 Force Sync）

## Phase 6: iOS Shortcut + 截图/收据识别 ✅（本地迁移已补）
- [x] `POST /api/receipt` 端点（`src/app/api/receipt/route.ts`）
  - 支持 multipart/form-data（来自 iOS Shortcut）
  - 支持 JSON body（base64 图片）
  - 支持收据照片、支付截图、银行/信用卡交易截图
  - 无 Plaid 账户时自动创建/复用 `iOS Capture` 手动账户
  - [x] `receipts` 表补充迁移（`supabase/migrations/002_ios_receipt_api_keys.sql`）
  - [x] API Key 认证替换为 `ak_...` token + SHA-256 hash 存储
- [x] Gemini Vision 交易截图解析（`src/lib/gemini/receipt-parser.ts`）
  - 使用 `gemini-2.0-flash` 模型
  - 支持 USD / CNY 自动识别
- [x] iOS Shortcut 配置指南（`ios-shortcut-guide.md`）
- [x] `/settings` 页面支持生成、复制、撤销 iOS Shortcut API key

## 尚未完成的数据库能力
以下能力在原始 Schema 设计里，页面或代码仍需继续对接：
- [ ] `categories` — 自定义分类表
- [ ] `budgets` — 预算表
- [x] `receipts` — 收据记录表（Phase 6 迁移已补，远端 Supabase 需执行迁移）
