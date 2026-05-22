# Multi-Agent Review Roles

请使用多 Agent 思路审查项目。  
即使你实际运行在一个 coding agent 中，也要按以下角色分别分析，然后由 Lead Agent 汇总。

---

# 1. Project Understanding Agent

负责理解项目整体情况。

检查：

- 技术栈
- framework
- package manager
- 目录结构
- 核心页面
- 核心 API
- 数据库方案
- 第三方服务
- 认证方式
- 构建和测试脚本

输出：

- 项目结构总结
- 核心模块地图
- 数据流概览
- 最复杂的几个区域
- 可用验证命令

---

# 2. Finance Domain Agent

负责审查记账业务语义。

检查：

- 金额表示方式
- 交易日期处理
- pending / posted transaction 处理
- 交易去重
- 分类优先级
- 预算统计口径
- account balance 逻辑
- merchant normalization
- recurring transaction 逻辑
- Plaid sync cursor
- webhook 处理

输出：

- 可能导致财务数据错误的问题
- 可能导致重复交易的问题
- 可能导致分类错乱的问题
- 可能导致预算统计错误的问题
- 需要测试覆盖的关键逻辑

---

# 3. Architecture Agent

负责架构审查。

检查：

- 模块边界
- UI 层是否包含过多业务逻辑
- API 层是否重复业务逻辑
- 数据访问是否统一
- services 是否清晰
- shared utilities 是否混乱
- 是否存在循环依赖
- 是否有重复实现
- 是否有难以扩展的结构

输出：

- 架构问题列表
- 影响范围
- 推荐重构方向
- 暂不建议立即修改的大型重构

---

# 4. Frontend Agent

负责前端体验和组件质量。

检查：

- 页面结构
- 组件拆分
- hooks 设计
- loading state
- error state
- empty state
- pagination
- filtering
- sorting
- responsive layout
- accessibility
- unnecessary re-render
- duplicated fetch
- client/server component 边界，如果适用

输出：

- 具体组件问题
- 用户体验风险
- 可立即修复的问题
- 需要后续重构的问题

---

# 5. Backend / API Agent

负责后端接口审查。

检查：

- API route 组织
- request validation
- response shape
- error handling
- auth check
- user ownership check
- third-party API calls
- Plaid error handling
- retry / timeout
- logging
- rate limit
- idempotency

输出：

- API 风险
- 权限风险
- 错误处理问题
- 数据一致性风险
- 推荐修复方案

---

# 6. Database Agent

负责数据库设计审查。

检查：

- schema
- migrations
- indexes
- unique constraints
- foreign keys
- cascade behavior
- nullable fields
- created_at / updated_at
- user_id isolation
- transaction uniqueness
- budget relation
- category relation
- account relation

输出：

- schema 问题
- 查询性能问题
- 数据一致性问题
- migration 风险
- 推荐索引和约束

---

# 7. Type Safety Agent

负责 TypeScript 和类型安全。

检查：

- any
- unsafe cast
- duplicated types
- weak API types
- missing validation schema
- nullable handling
- optional handling
- inconsistent model types
- database type mismatch
- frontend/backend type drift

输出：

- 高风险类型问题
- 可以直接修复的类型问题
- 需要 schema validation 的区域
- 推荐 shared types 方案

---

# 8. Security Agent

负责安全审查。

检查：

- authentication
- authorization
- user data isolation
- insecure direct object reference
- environment variables
- secrets leakage
- logs with sensitive data
- input validation
- XSS
- CSRF，如果适用
- SQL injection，如果适用
- webhook verification
- public route exposure

输出：

- P0 / P1 安全问题
- 涉及文件
- 攻击或误用场景
- 推荐修复
- 验证方式

---

# 9. Performance Agent

负责性能审查。

检查：

- transaction list 是否分页
- large list rendering
- repeated API requests
- N+1 queries
- missing indexes
- expensive computation
- bundle size
- unnecessary client components
- slow dashboard aggregation
- cache strategy
- waterfall requests

输出：

- 性能瓶颈
- 用户影响
- 快速优化点
- 长期优化点

---

# 10. Testing Agent

负责测试和验证能力审查。

检查：

- 是否有测试框架
- 是否有 unit tests
- 是否有 integration tests
- 是否有 e2e tests
- 是否有 seed data
- 是否有 mock Plaid
- 是否有 money/date/category 测试
- 是否有 API 权限测试
- 是否有 regression tests

输出：

- 测试缺口
- 最需要补的测试
- 每个高风险模块的推荐测试
- 当前能运行的验证命令

---

# 11. DevEx Agent

负责工程体验审查。

检查：

- README
- env example
- package scripts
- lint
- format
- typecheck
- test
- build
- CI
- local setup
- naming conventions
- folder conventions

输出：

- 新人上手风险
- 文档缺口
- 命令缺口
- 推荐工程规范

---

# Lead Agent

Lead Agent 负责：

1. 汇总所有 Agent 的发现。
2. 去重。
3. 按 P0 / P1 / P2 / P3 排序。
4. 识别哪些可以立即修。
5. 识别哪些只能进入 roadmap。
6. 制定小步修复计划。
7. 执行低风险修复。
8. 输出最终报告。
