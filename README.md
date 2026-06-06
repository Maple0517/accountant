# Accountant

个人财务工作台：同步银行卡交易、清洗商户与分类、管理预算/复核事项，并支持 iOS 截图记账和 Notion 单向同步。

默认生产地址：<https://accountant-rose.vercel.app>

## 核心链路

1. Supabase Auth 登录。
2. Plaid Link 连接银行/信用卡账户。
3. 后端通过 Plaid `/transactions/sync` + cursor 增量同步交易。
4. Plaid webhook 与手动同步复用同一套入库逻辑。
5. 交易进入 Transactions 后，可复核分类、退款、转账、拆分、预算口径。
6. Gemini 用于 Plaid fallback 分类优化和 iOS 收据/支付截图识别。
7. Budgets、Dashboard、Analytics 使用统一的交易语义 helper 计算报表。
8. Notion Sync 将 Supabase 交易单向推送到用户自己的 Notion 数据库。
9. Scriptable Widget 可在 iPhone 桌面显示最近交易。

## 功能地图

| 区域 | 状态 | 入口/说明 |
|---|---|---|
| Auth | 可用 | Supabase Email/Password，OAuth callback 位于 `/auth/callback` |
| Dashboard | 可用 | 行动优先 cockpit：核心指标、待复核、最大驱动因素 |
| Transactions | 核心页面 | 保存视图、筛选、AI pending、退款/转账复核、split、隐藏/删除语义 |
| Accounts | 可用 | Plaid item/account 管理，支持 delete-history archive 语义 |
| Budgets | 可用，高风险 | `src/modules/budget/` 使用 Engine/Adapter/Repository/Service 分层 |
| Analytics | 可用 | 偏 review/insights，不是单纯图表页 |
| iOS Capture | 可用 | `/api/receipt` + `ak_...` API key + Gemini Vision |
| Scriptable Widget | 可用 | `/api/widget/recent-transactions` |
| Notion Sync | 可用 | Supabase -> Notion 单向同步；token 存用户 profile |
| Plaid Cron | 可用 | Vercel 每日同步 `/api/cron/plaid-sync` |
| Notion Outbox Cron | 可用 | Vercel 每日处理 `/api/cron/notion-outbox` |

## 文档入口

- [`AI_HANDOFF.md`](./AI_HANDOFF.md)：新 Agent/Codex 接手先读，包含当前坑位和禁改点。
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)：系统结构、数据流、模块边界、关键语义。
- [`docs/OPERATIONS.md`](./docs/OPERATIONS.md)：本地运行、环境变量、部署、故障排查。
- [`docs/ios-shortcut-guide.md`](./docs/ios-shortcut-guide.md)：iOS 快捷指令截图记账配置。
- [`docs/scriptable/README.md`](./docs/scriptable/README.md)：iPhone Scriptable 最近交易小组件。

## 技术栈

| 层 | 技术 |
|---|---|
| App | Next.js App Router, React, TypeScript |
| UI | Tailwind CSS, Radix UI/shadcn 风格组件 |
| DB/Auth | Supabase PostgreSQL + Supabase Auth |
| Bank sync | Plaid API |
| AI | Google Gemini |
| External sync | Notion REST API |
| Deploy | Vercel + Supabase Cloud |

## 本地开发

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开：<http://localhost:3000>

常用检查：

```bash
npm run typecheck
npm run lint
npm run pretest
npm test
npm run build
```

## 环境变量

完整模板见 [`.env.example`](./.env.example)。核心变量：

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=production
PLAID_WEBHOOK_URL=https://your-domain.com/api/plaid/webhook?secret=...
PLAID_WEBHOOK_SECRET=
CRON_SECRET=

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
```

Notion token 由用户在 `/settings` 页面配置，后端从 `profiles.notion_token` 读取；不要把个人 Notion token 硬编码进代码。

## 最高优先级注意事项

- 不要清空 `plaid_items`：生产 `access_token` 和 cursor 在这里，删掉会要求用户重新授权。
- Notion 创建数据库使用原生 `fetch` 绕过 SDK 问题，不要改回 `notion.databases.create()`。
- 报表只使用有效交易：未删除、未隐藏、非 split parent，并遵守 pending/excluded/refund/transfer/split 语义。
- 账户 delete-history 是 archive + soft-delete 交易，不是硬删账户。
- 修改 Next.js routing/middleware/proxy 相关逻辑前，先读本地 Next 文档。
