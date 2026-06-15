# Scriptable 最近交易 Widget

这是 Accountant 的 iPhone Scriptable 大号小组件集成。它不是原生 iOS App、WidgetKit extension 或 PWA；它是一个复制到 Scriptable 的脚本，调用 Accountant API 渲染最近交易。

脚本文件：

```text
docs/scriptable/recent-transactions-widget.js
```

API：

```text
GET /api/widget/recent-transactions
```

## 1. 准备 API Key

1. 打开 Accountant 并登录。
2. 进入 `Settings`。
3. 找到 API Key / iOS Shortcut Capture 区域。
4. 生成一个 `ak_...` key。
5. 立刻复制；完整 key 只显示一次。

Widget 和 iOS Shortcut 复用同一套 hashed API key 机制。

## 2. 安装脚本

1. 在 iPhone 安装并打开 Scriptable。
2. 新建脚本。
3. 复制 `recent-transactions-widget.js` 全部内容进去。
4. 只替换这一行：

```js
const API_KEY = "PASTE_YOUR_API_KEY_HERE"
```

改成：

```js
const API_KEY = "ak_your_key_here"
```

不要写 `Bearer`；脚本会把 key 放进 `api_key` 查询参数，和 Safari 调试 URL 保持一致。

默认生产配置：

```js
const API_URL = "https://accountant-rose.vercel.app/api/widget/recent-transactions"
const API_KEY = "PASTE_YOUR_API_KEY_HERE"
const APP_URL = "https://accountant-rose.vercel.app/transactions"
const MAX_TRANSACTIONS = 7
```

## 3. 添加桌面 Widget

1. 在 Scriptable 里先运行一次脚本，确认能预览。
2. 长按 iPhone 桌面。
3. 添加 Scriptable widget。
4. 选择大号。
5. 编辑 widget，选择这个脚本。

iOS 控制刷新频率；它不是实时行情式刷新。

## 4. 显示语义

- Header：`Fetched ...`，表示 Scriptable 刚从 API 拉到数据。
- Footer：`Synced ...`，表示后端最近一次 Plaid 成功同步时间。
- 如果后端没有可用 `last_synced_at`，Footer 会退回 `Fetched ...`。

## 5. API Response

```ts
type WidgetRecentTransactionsResponse = {
  updatedAt: string
  lastSyncedAt: string | null
  count: number
  transactions: WidgetTransaction[]
}

type WidgetTransaction = {
  id: string
  merchant: string
  subtitle: string
  amount: number
  currency: string
  date: string
  dateLabel: string
  pending: boolean
  isIncome: boolean
  kind: 'normal' | 'refund' | 'reimbursement' | 'transfer'
  category: {
    id: string | null
    name: string
    label: string
    icon: string | null
    color: string | null
    type: 'income' | 'expense' | 'transfer' | null
  }
}
```

API 不返回用户 email、Plaid token、Notion token、raw API key 或完整账号。

## 6. 调试

浏览器登录态测试：

```text
/api/widget/recent-transactions
```

API key 测试：

```bash
curl "https://accountant-rose.vercel.app/api/widget/recent-transactions?limit=7&api_key=ak_xxx"
```

未认证时应返回 unauthorized；`404` 通常表示当前部署不含 widget route。

## 7. 常见问题

### Unable to load transactions

通常是手机仍在运行旧脚本、API key 错、已撤销、多写了 `Bearer`，或生产部署缺少 widget route。

### 仍显示旧文案

手机运行的是旧脚本。重新复制当前 `recent-transactions-widget.js`，并先在 Scriptable app 内手动运行一次，让它写入缓存。

### 底部显示 Fetched 而不是 Synced

后端没有找到当前用户非空的 Plaid `last_synced_at`。打开 Accountant 手动同步 Plaid 后再运行脚本。

### 行被裁切

调整脚本顶部常量：

```js
const MAX_TRANSACTIONS = 7
const CONTENT_WIDTH = 336
const ROW_HEIGHT = 39
const LEFT_WIDTH = 146
const PILL_WIDTH = 72
const AMOUNT_WIDTH = 78
const DOT_WIDTH = 9
```

优先减少 `ROW_HEIGHT` 或 `MAX_TRANSACTIONS`；右侧空白太多时先增大 `CONTENT_WIDTH`。
