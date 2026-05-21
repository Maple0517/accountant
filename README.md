# Accountant — 个人智能记账

> 类 Copilot Money 的个人财务工作台：同步银行卡交易、用 AI 清洗商户名和分类、支持 iOS 截图记账，并可把结构化交易同步到 Notion。

**线上地址**: https://accountant-rose.vercel.app

---

## 现在项目到底是什么

Accountant 是一个 Next.js 全栈个人财务应用，当前核心链路是：

1. 用户通过 Supabase Auth 登录。
2. 通过 Plaid Link 连接银行/信用卡账户。
3. 后端用 Plaid `/transactions/sync` + cursor 增量同步交易。
4. Plaid webhook 有更新时触发同一套同步逻辑。
5. 交易入库后先用 Plaid 分类兜底，再可进入 Gemini AI 分类队列进行商户名清洗和分类优化。
6. 用户可在 Transactions 页面手动修改分类，并可批量应用到同名交易。
7. 用户可通过 iOS Shortcut 上传收据/消费截图，由 Gemini Vision 解析成手动交易。
8. 用户可把交易单向同步到自己的 Notion 数据库。

---

## 当前功能状态

| 模块 | 状态 | 说明 |
|---|---:|---|
| Auth | ✅ 可用 | Supabase Email/Password 登录注册 |
| Plaid Link | ✅ 可用 | 当前面向 Production 环境；部分大银行 OAuth 需 Plaid Dashboard 额外配置 |
| Plaid Sync | ✅ 可用 | `/transactions/sync` cursor 增量同步；webhook 和手动同步复用同一套逻辑 |
| Plaid Cron 兜底 | ✅ 已接入 | `vercel.json` 调用 `/api/cron/plaid-sync`，生产需配置 `CRON_SECRET` |
| Transactions | ✅ 可用 | 搜索、筛选、按日期分组、账户/卡来源显示、分类 pill 修改 |
| AI 分类队列 | ✅ 可用 | Gemini 批处理刷新 Plaid fallback 分类；仍需后续后台化体验优化 |
| iOS 截图记账 | ✅ 可用 | `/api/receipt` + Shortcut API Key + Gemini Vision |
| Notion Sync | ✅ 可用 | Supabase → Notion 单向同步；Notion Token 存用户 profile，不在 env |
| Accounts | ✅ 可用 | 查看连接账户、余额、账户类型 |
| Analytics | 🟡 部分可用 | 页面存在；图表/指标需要继续接真实数据和优化口径 |
| Budgets | 🟡 重构中 | 已有预算 domain/engine/计划文档；页面和真实数据口径需要继续完善 |
| Excluded Category / 不计入 | 🟡 待实现 | 已有 implementation plan；需要 migration + adapter + UI 验收 |

---

## 文档入口

建议阅读顺序：

1. [`AI_HANDOFF.md`](./AI_HANDOFF.md) — 新 Agent / Codex 接手先读，记录真实状态、禁改点和近期任务。
2. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 系统架构、数据库表、API、关键数据流。
3. [`docs/implementation-plans/transaction-page-refactor/`](./docs/implementation-plans/transaction-page-refactor/) — 交易页相关渐进式重构计划。
4. [`docs/ios-shortcut-guide.md`](./docs/ios-shortcut-guide.md) — iOS 快捷指令配置指南。

> 约定：README 只做项目入口和状态总览；`AI_HANDOFF.md` 记录“当前真实状态 + 坑”；`docs/ARCHITECTURE.md` 记录长期架构，不写临时 TODO。

---

## 技术栈

| 层 | 技术 |
|---|---|
| Framework | Next.js App Router + Turbopack |
| Language | TypeScript |
| Styling | Tailwind CSS + Radix UI |
| Database / Auth | Supabase PostgreSQL + Auth |
| Bank Sync | Plaid API, Production |
| AI Classification / OCR | Google Gemini |
| Notion Sync | Notion REST API v1，原生 fetch |
| Deploy | Vercel + Supabase Cloud |

---

## 本地开发

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开：http://localhost:3000

环境变量说明见 [`.env.example`](./.env.example)。

### 关键环境变量

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=production
PLAID_WEBHOOK_SECRET=
PLAID_WEBHOOK_URL=https://your-domain.com/api/plaid/webhook?secret=...
CRON_SECRET=

GEMINI_API_KEY=
```

Notion Token 不放在 `.env.local`，由用户在 `/settings` 页面填写，服务端从 `profiles.notion_token` 读取。

---

## 近期优先级

1. 完成 Transactions 页面重构：银行/卡来源、分类视图、`不计入` 分类。
2. 完成 Budget 真实数据口径：pending、income/transfer、excluded category、rollover 的边界。
3. 把 AI 分类队列从前端触发逐步迁移到后台/定时任务，减少用户等待。
4. 补齐 Analytics 真实数据和月度报表口径。
5. 保持 Plaid `/transactions/refresh` 为手动强刷/付费 add-on 能力，不作为默认自动刷新方案。
