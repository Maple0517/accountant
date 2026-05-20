# Accountant — 个人智能记账

> 类 Copilot 的个人财务追踪服务。通过 Plaid API 自动同步银行/信用卡消费，支持 iOS 截图一键记账，并同步至 Notion。

**线上地址**: https://accountant-rose.vercel.app

---

## 功能

- 🏦 **银行自动同步** — 通过 Plaid（Production 环境）增量拉取信用卡和银行账户交易
- 📱 **iOS 截图记账** — 分享收据/支付截图到 iOS 快捷指令，Gemini Vision 自动识别并记录
- 📝 **Notion 同步** — 交易数据单向推送至用户自己的 Notion 数据库
- 📊 **数据看板** — Dashboard / Transactions / Analytics / Accounts / Budgets

## 技术栈

| 层 | 技术 |
|---|---|
| Framework | Next.js (App Router + Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS + Radix UI |
| Database / Auth | Supabase (PostgreSQL + Auth) |
| Bank Sync | Plaid API (Production) |
| Notion Sync | Notion REST API v1 (原生 fetch，绕过 SDK bug) |
| Receipt OCR | Google Gemini 2.0 Flash (Vision) |
| Deploy | Vercel + Supabase Cloud |

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入各项密钥
npm run dev                  # → http://localhost:3000
```

环境变量说明见 [`.env.example`](.env.example)。

> **注意**：Notion Token 不在 `.env.local` 里，由用户在 `/settings` 页面填写，存入 Supabase `profiles.notion_token`。

## 文档

- [`AI_HANDOFF.md`](./AI_HANDOFF.md) — **AI Agent 接手必读**：当前真实状态、已知 bug、关键 workaround
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 系统架构、数据库 Schema、API 设计
- [`docs/ios-shortcut-guide.md`](./docs/ios-shortcut-guide.md) — iOS 快捷指令配置指南
