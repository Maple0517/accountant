# Review Checklist

请按以下维度系统审查项目。

---

# Architecture

检查：

- 项目目录是否清晰
- 页面、组件、API、service、database 层是否分离
- 是否有业务逻辑散落在 UI 组件中
- 是否有重复 service
- 是否有重复 API helper
- 是否存在循环依赖
- 是否有难以测试的模块
- 是否有过大的文件
- 是否有过大的组件
- 是否有过长函数
- 是否有隐式全局状态

---

# Frontend

检查：

- transaction list 是否可维护
- budget 页面是否和数据模型匹配
- dashboard 数据来源是否清晰
- filtering / sorting / pagination 是否一致
- loading / empty / error state 是否完整
- 表单校验是否可靠
- UI 是否依赖 hardcoded data
- 是否有重复 fetch
- 是否有 stale state
- 是否有 optimistic update 风险
- 是否有不必要 re-render
- 是否有 accessibility 问题

---

# API

检查：

- 每个 route 是否做 auth
- 每个 route 是否做 user ownership check
- 参数是否校验
- response shape 是否一致
- error shape 是否一致
- 是否泄露内部错误
- 是否有 idempotency 设计
- 是否有 retry / timeout
- 是否有 rate limit 需求
- webhook 是否验证来源
- 第三方 API 错误是否被正确处理

---

# Database

检查：

- transaction 是否有唯一约束
- account 是否绑定 user
- category 是否绑定 user 或 system scope
- budget 是否绑定 user
- 查询是否都有 user_id 条件
- 是否缺 index
- 是否有 nullable 字段导致逻辑分支混乱
- 是否有 money 字段使用 float
- 是否有 date/time 字段语义不清
- migration 是否安全

---

# TypeScript

检查：

- any
- unknown 后没有 narrow
- as 滥用
- API response 没有类型
- database record 类型和 UI 类型混在一起
- nullable 没处理
- optional 没处理
- duplicated type definitions
- missing return type on complex functions
- schema validation 缺失

---

# Finance Logic

检查：

- 金额单位是否统一
- 是否使用 cents / integer
- 是否有浮点误差
- income / expense 正负号是否一致
- refund / transfer 是否处理
- pending transaction 是否进入预算统计
- deleted / hidden transaction 是否进入统计
- manual category override 是否优先于 AI
- budget period 是否按正确时间范围算
- timezone 是否影响日期归属

---

# Security

检查：

- 用户是否可能读取别人的账户
- 用户是否可能修改别人的交易
- 用户是否可能删除别人的分类
- public API 是否暴露敏感数据
- server logs 是否输出 access token
- env 是否泄露
- Plaid access_token 是否安全存储
- webhook 是否可被伪造
- AI API 是否收到过多敏感数据

---

# Performance

检查：

- transaction list 是否分页
- dashboard aggregation 是否低效
- 是否有 N+1 query
- 是否缺 index
- 是否每次 render 都重新计算大数组
- 是否重复请求同一数据
- 是否有 bundle 过大问题
- 是否不必要地 client-side fetch
- 是否可以 server-side aggregate

---

# Testing

检查：

- money utility tests
- date utility tests
- category rule tests
- transaction sync tests
- transaction dedupe tests
- budget calculation tests
- API auth tests
- API ownership tests
- UI smoke tests
- Plaid mock tests

---

# DevEx

检查：

- README 是否说明如何运行
- env example 是否完整
- scripts 是否齐全
- typecheck 是否可运行
- lint 是否可运行
- build 是否可运行
- test 是否可运行
- CI 是否存在
- 错误信息是否利于调试
