# Accountant — 个人智能记账

> 类 Copilot 的个人财务工作台。自动同步银行卡消费、用 AI 清洗商户名和分类、支持 iOS 截图记账，并把结构化数据同步到 Notion。

**线上地址**: https://accountant-rose.vercel.app

---

## 已有功能

### 银行与交易同步

- 🏦 **Plaid 银行连接** — 支持 Production 环境，通过 Plaid Link 连接银行、信用卡和子账户。
- 🔁 **增量交易同步** — 使用 Plaid `/transactions/sync` cursor 增量拉取新增/修改交易，避免重复导入。
- 💳 **账户识别** — 交易列表直接展示具体账户/卡名，例如 `Bilt Palladium Card`，不再用笼统的 `plaid` 作为来源显示。
- ⏳ **Pending 状态保留** — pending 交易在列表和预算计算中有明确处理，避免临时授权污染实际支出。

### AI 分类与手动校正

- 🤖 **Gemini 交易分类** — Plaid 交易先用 Plaid 分类兜底，再进入 Gemini 队列刷新为更贴近用户习惯的分类。
- 🧾 **商户名清洗** — AI 会把原始银行描述清洗成更易读的商户名，用于交易列表、分析和同步。
- 🚦 **额度保护队列** — 默认使用 `gemini-3.1-flash-lite`，按 `15 RPM / 250k TPM / 500 RPD` 和批次大小处理，适合一次性处理大量 pending AI 分类。
- 📊 **队列进度显示** — Transactions 页面显示 AI 分类任务总数、pending、done、failed，用户可以主动触发刷新。
- 🏷️ **可点击分类 pill** — 每笔交易的当前分类就是彩色 pill button，点击即可行内选择新分类。
- 🧩 **同名交易批量校正** — 用户修改一笔交易后，系统会询问是否把同一商户/交易名的记录批量改成同类。
- 🔒 **用户选择优先** — 手动改过的分类会清除自动分类标签，后续 AI/Plaid 不会随意覆盖用户确认过的结果。

### 截图记账与 Notion

- 📱 **iOS 截图记账** — 分享收据、支付截图或消费页面到 iOS 快捷指令，上传到 `/api/receipt` 自动解析。
- 🔐 **Shortcut API Key** — Settings 页面可管理 iOS Shortcut 专用 API Key，服务端只保存 hash。
- 🧠 **Gemini Vision OCR** — 自动识别截图里的金额、币种、商户、日期和备注，并写入交易。
- 📝 **Notion 单向同步** — 将交易同步到用户自己的 Notion 数据库，保留金额、币种、日期、分类、账户、来源和标签。

### 财务工作台

- 📊 **Dashboard** — 汇总近期收支、趋势和关键财务指标。
- 💳 **Transactions** — 支持搜索、来源/币种/日期筛选、分类修改、AI 刷新和按日期分组查看。
- 📈 **Analytics** — 按分类和时间维度分析消费结构。
- 🏦 **Accounts** — 管理和查看已连接账户、余额和账户类型。
- 🎯 **Budgets** — 按分类设置预算，统计月度实际支出、剩余额度和超预算状态。

## Roadmap

- 🧠 **分类记忆规则** — 把用户批量校正过的商户沉淀成规则，后续同步时优先自动套用。
- 🔄 **AI 队列后台化** — 将当前前端触发的队列处理升级为定时任务或 durable workflow，减少用户等待。
- 🧪 **分类质量反馈** — 为 AI 分类增加“正确/错误”反馈入口，用于调试提示词和规则优先级。
- 📬 **预算提醒** — 支持接近预算阈值、超预算、异常大额消费的通知。
- 📤 **导出与报表** — 导出 CSV/Excel，并生成月度消费报告。
- 👥 **多人/家庭账本** — 支持共享预算、家庭成员账户和权限隔离。
- 🌏 **多币种增强** — 汇率换算、按币种分组预算、跨币种总览。
- 🧾 **更多票据来源** — 扩展邮件账单、PDF 收据和更多支付截图格式。

## 技术栈

| 层 | 技术 |
|---|---|
| Framework | Next.js (App Router + Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS + Radix UI |
| Database / Auth | Supabase (PostgreSQL + Auth) |
| Bank Sync | Plaid API (Production) |
| Notion Sync | Notion REST API v1 (原生 fetch，绕过 SDK bug) |
| AI Classification / Receipt OCR | Google Gemini 3.1 Flash Lite |
| Deploy | Vercel + Supabase Cloud |

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入各项密钥
npm run dev                  # → http://localhost:3000
```

环境变量说明见 [`.env.example`](.env.example)。

> **注意**：Notion Token 不在 `.env.local` 里，由用户在 `/settings` 页面填写，存入 Supabase `profiles.notion_token`。

### AI 分类额度

Plaid 导入交易会进入 AI 分类队列，默认使用 `gemini-3.1-flash-lite`，并按以下默认限制处理：`15 RPM`、`250k TPM`、`500 RPD`、每批最多 `20` 笔。可通过 `.env.local` 覆盖：

```bash
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_CLASSIFIER_RPM_LIMIT=15
GEMINI_CLASSIFIER_TPM_LIMIT=250000
GEMINI_CLASSIFIER_RPD_LIMIT=500
GEMINI_CLASSIFIER_BATCH_SIZE=20
GEMINI_CLASSIFIER_MAX_REQUESTS_PER_RUN=5
GEMINI_CLASSIFIER_MAX_INPUT_TOKENS=200000
```

## 文档

- [`AI_HANDOFF.md`](./AI_HANDOFF.md) — **AI Agent 接手必读**：当前真实状态、已知 bug、关键 workaround
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 系统架构、数据库 Schema、API 设计
- [`docs/ios-shortcut-guide.md`](./docs/ios-shortcut-guide.md) — iOS 快捷指令配置指南
