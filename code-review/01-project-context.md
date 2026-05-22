# Project Context

当前项目是一个 AI 记账 / 个人财务管理 Web 产品。

项目可能包含以下核心模块：

- 银行账户连接
- Plaid transaction sync
- 交易记录页面
- 交易分类
- AI 自动分类
- 手动分类覆盖
- budget / 预算管理
- dashboard / 汇总页面
- account / 账户管理
- transaction list / 交易列表
- merchant normalization
- recurring transaction detection
- 用户认证
- 用户数据隔离

请不要假设所有模块都已经存在。  
你需要通过代码真实确认项目目前实现了哪些模块。

---

# Business Priorities

本项目最重要的是：

1. 交易数据准确。
2. 用户数据隔离安全。
3. 金额、日期、分类不能错。
4. Plaid 同步不能重复导入交易。
5. dashboard、budget、transaction list 之间的数据口径要一致。
6. AI 自动分类不能覆盖用户手动修改，除非业务明确允许。
7. 项目后续要方便继续扩展。

---

# Areas To Identify First

请优先找到以下文件或模块，如果存在：

## Frontend

- transaction list 页面
- transaction detail 组件
- budget 页面
- dashboard 页面
- account 页面
- category 管理页面
- Plaid Link 相关页面或组件

## Backend / API

- transactions API
- accounts API
- budgets API
- categories API
- Plaid webhook API
- Plaid sync API
- AI categorization API
- auth middleware
- database client
- shared services

## Database

- users table
- accounts table
- transactions table
- categories table
- budgets table
- plaid items table
- sync cursor field
- merchant field
- pending transaction fields
- timestamps
- indexes
- unique constraints

## Shared Logic

- money utilities
- date utilities
- category rules
- AI classification logic
- transaction deduplication logic
- API response helpers
- auth helpers
- validation schemas

---

# Important Questions To Answer

在审查过程中，请回答：

1. 交易数据从 Plaid 进入系统后，经过哪些步骤进入数据库？
2. 一条 transaction 的唯一性如何保证？
3. pending transaction 和 posted transaction 如何处理？
4. 用户手动修改分类后，AI 是否可能覆盖？
5. 金额是用 number、string、decimal 还是 integer cents 表示？
6. 日期和时区如何处理？
7. budget summary 的数据来源是否和 transaction list 一致？
8. API 是否每次都做用户权限校验？
9. 前端是否可能看到其他用户的数据？
10. 是否有重复 fetch、重复状态、重复业务逻辑？
11. 是否存在 hardcoded demo data 或 mock data 混入生产逻辑？
12. 是否有缺失的 loading / error / empty state？
13. 是否有无法验证的关键业务逻辑？

---

# Do Not Assume

不要假设：

- 项目已经使用最佳实践
- 数据库约束已经正确
- API 已经做权限校验
- 金额计算是安全的
- 日期处理是统一的
- Plaid 同步不会重复
- AI 分类不会误覆盖
- 前端展示和后端统计使用同一口径

你需要通过真实代码确认。
