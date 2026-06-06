# iOS Shortcut 截图记账指南

用 iPhone 分享面板把收据、支付截图或银行交易截图发到 Accountant。后端会用 Gemini Vision 识别交易并写入账本。

默认接口：

```text
https://accountant-rose.vercel.app/api/receipt
```

## 1. 准备

1. 打开 Accountant 并登录。
2. 进入 `Settings`。
3. 找到 `iOS Shortcut Capture` / API Key 区域。
4. 生成一个 `ak_...` key。
5. 立刻复制保存；完整 key 只显示一次。

## 2. 推荐快捷指令：从分享面板上传图片

### 创建快捷指令

1. 打开 iPhone 的「快捷指令」。
2. 新建快捷指令，命名为 `记一笔交易`。
3. 打开快捷指令详情。
4. 开启「在共享表单中显示」。
5. 输入类型只保留「图像」。

### 动作顺序

#### 动作 1：调整图像大小

- 输入：快捷指令输入
- 宽度：`1280`
- 高度：自动保持比例

#### 动作 2：文本

内容：

```text
https://accountant-rose.vercel.app/api/receipt
```

#### 动作 3：获取 URL 内容

- URL：上一步文本
- 方法：`POST`
- 请求正文：`表单`

表单字段：

| 字段 | 类型 | 值 |
|---|---|---|
| `image` | 文件 | 调整后的图片 |
| `api_key` | 文本 | 你的 `ak_...` key |
| `currency` | 文本 | 常用币种，例如 `USD` 或 `CNY` |
| `notes` | 文本 | 可选备注 |
| `idempotency_key` | 文本 | 建议用「UUID」动作生成 |

`image` 必须是「文件」，不要转 Base64 文本。

#### 动作 4：显示结果

显示「获取 URL 内容」的返回结果。

## 3. 日常使用

1. 对支付成功页、收据、Apple Pay、微信/支付宝、银行交易详情截图。
2. 打开截图，点分享。
3. 选择 `记一笔交易`。
4. 等待返回。
5. 成功后在 Accountant 的 `iOS Capture` 账户下查看交易。

## 4. 服务端会做什么

- 用 `ak_...` key 验证用户，数据库只存 key hash。
- 用 Gemini Vision 提取商户、金额、日期、币种、支付方式和交易类型。
- 创建或复用 `accounts.name = 'iOS Capture'` 的手动账户。
- 写入 `transactions.source = 'receipt'` 的交易。
- 记录 receipt 解析状态和原始解析摘要。
- 如果用户开启 Notion Sync，会尝试同步；Notion 失败不应影响交易入账。

## 5. 返回示例

```json
{
  "success": true,
  "receipt": {
    "capture_type": "payment_screenshot",
    "transaction_type": "expense",
    "store_name": "Starbucks",
    "date": "2026-05-20",
    "total": 6.45,
    "currency": "USD",
    "payment_method": "Apple Pay"
  },
  "confidence": 0.92,
  "transaction_id": "..."
}
```

## 6. 常见问题

### 返回 Unauthorized

- `api_key` 填错、丢失、已撤销，或多复制了空格。
- 回到 Settings 重新生成 key，并更新快捷指令。

### 上传失败或超时

- 图片过大：确认已先调整到 1280 宽。
- 网络问题：重新运行同一次快捷指令时应保留同一个 `idempotency_key`，避免重复入账。
- Gemini 临时失败：稍后重试。

### 账目重复

- 确认快捷指令传了 `idempotency_key`。
- 不要对同一张图连续生成不同 UUID 重试。

### Key 丢了

完整 key 无法再次显示。去 Settings 撤销旧 key，重新生成并更新快捷指令。
