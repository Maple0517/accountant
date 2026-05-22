# Domain-Specific Finance Review

本文件专门用于 AI 记账 / 个人财务管理项目的领域审查。

请特别关注以下内容。

---

# 1. Transaction Accuracy

检查：

- transaction id 如何生成
- Plaid transaction_id 是否保存
- 是否有唯一约束防止重复交易
- pending transaction 和 posted transaction 如何关联
- removed transaction 如何处理
- modified transaction 如何更新
- sync cursor 如何保存
- 重复同步是否幂等
- 分页同步是否完整

风险：

- 重复交易
- 丢失交易
- pending 和 posted 同时存在
- 旧交易未更新
- 删除交易仍进入统计

---

# 2. Money Representation

检查：

- 金额用 number / string / Decimal / integer cents 哪一种
- 前端展示金额和后端存储金额是否一致
- 数据库字段类型是否安全
- 是否存在 JavaScript 浮点误差
- expense / income 正负号是否统一
- transfer 是否特殊处理
- refund 是否特殊处理
- currency 是否保存
- 多币种是否被假设为单币种

风险：

- 金额精度错误
- 收入支出反向
- 预算统计错误
- dashboard 总额错误

---

# 3. Date and Timezone

检查：

- transaction date
- authorized date
- posted date
- created_at
- updated_at
- budget period start / end
- dashboard period
- user timezone
- database timezone
- frontend timezone

风险：

- 月预算归属错误
- 某些交易跨天
- dashboard 和 transaction list 不一致
- Plaid 日期和本地日期混用

---

# 4. Category System

检查：

- system category 和 user category 是否区分
- category 是否绑定 user_id
- 删除 category 后 transaction 如何处理
- AI category 和 manual category 如何区分
- 用户手动修改是否有最高优先级
- category rule 是否可解释
- uncategorized 如何处理

风险：

- AI 覆盖用户手动分类
- 用户看到其他用户 category
- 删除分类导致交易异常
- budget 按错误分类统计

---

# 5. Budget Logic

检查：

- budget 是按 category 还是 group
- budget period 如何定义
- rollover 是否存在
- pending transaction 是否计入
- transfer 是否排除
- income 是否排除
- hidden / deleted transaction 是否排除
- budget summary 和 transaction list filter 是否一致
- 超支计算是否正确

风险：

- 预算剩余额错误
- 月度统计错误
- 分类统计重复
- dashboard 和 budget 页面不一致

---

# 6. Account Logic

检查：

- account 是否绑定 user
- Plaid account_id 是否保存
- account mask 是否安全展示
- account balance 是否来自 Plaid 还是本地计算
- closed account 如何处理
- deleted account 的交易如何处理
- 多账户交易是否正确隔离

风险：

- 账户串数据
- balance 不准
- 删除账户导致交易丢失
- 用户看到别人的账户

---

# 7. Plaid Integration

检查：

- Plaid access_token 存储位置
- item_id 存储方式
- webhook 验证
- sync cursor
- transactions/sync 是否分页
- removed transactions 是否处理
- rate limit 处理
- Plaid error code 处理
- sandbox / development / production 环境区分
- token exchange 是否安全

风险：

- token 泄露
- 重复拉取交易
- sync 中断后状态错误
- webhook 被伪造
- 生产和测试环境混用

---

# 8. AI Categorization

检查：

- 发送给 AI 的交易字段是否过多
- 是否泄露敏感数据
- AI 输出是否校验
- 分类置信度是否保存
- 是否允许用户覆盖
- 是否会重复分类同一交易
- 是否能回滚错误分类
- 是否有 fallback

风险：

- 敏感数据外发过多
- AI 输出非法 category
- 用户手动分类被覆盖
- 预算统计受 AI 错误影响

---

# 9. User Data Isolation

检查所有涉及用户数据的查询是否包含 user_id 或等价 owner 条件：

- transactions
- accounts
- categories
- budgets
- plaid items
- rules
- AI categorization jobs
- dashboard aggregation

风险：

- IDOR
- 读取其他用户交易
- 修改其他用户 budget
- 删除其他用户 category

---

# 10. Required Tests For Finance Logic

建议优先补以下测试：

1. transaction deduplication
2. pending to posted transition
3. removed transaction handling
4. amount sign convention
5. budget monthly calculation
6. manual category override
7. AI category fallback
8. API user ownership
9. Plaid sync idempotency
10. date boundary around month start/end
