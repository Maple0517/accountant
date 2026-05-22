# Technical Debt Prioritization

发现问题后，请按以下标准排序。

---

# Priority Levels

## P0

必须优先处理。

包括：

- 用户数据泄露
- 越权访问
- 交易金额错误
- 交易重复入库
- budget 统计明显错误
- Plaid sync 会破坏数据
- 生产构建失败
- 数据库 migration 会丢数据
- 明确安全漏洞

P0 问题如果不能安全修复，必须明确阻断原因。

---

## P1

高优先级技术债。

包括：

- 核心业务逻辑重复
- 类型系统无法保护核心数据
- API 错误处理不一致
- 用户数据隔离依赖前端
- 交易列表性能明显不可扩展
- 缺少关键数据库约束
- 关键流程没有测试
- 金额 / 日期 / 分类逻辑散落多处
- Plaid sync 缺少幂等设计

P1 应该优先规划修复。

---

## P2

中优先级问题。

包括：

- 组件过大
- hooks 设计混乱
- 部分重复代码
- loading / empty / error state 不完整
- README 不完整
- env 文档不完整
- 缺少部分类型
- 部分命名不清晰
- 非核心性能问题

P2 可以分批处理。

---

## P3

低优先级优化。

包括：

- 代码风格统一
- 小范围命名优化
- 注释补充
- 文件移动
- UI 细节优化
- 非关键重构
- 长期架构优化建议

P3 不要阻塞当前任务。

---

# Scoring Model

每个问题请给出以下评估：

```md
- Priority:
- User Impact: High / Medium / Low
- Data Risk: High / Medium / Low
- Security Risk: High / Medium / Low
- Maintenance Cost: High / Medium / Low
- Fix Complexity: High / Medium / Low
- Confidence: High / Medium / Low
```

---

# Immediate Fix Eligibility

只有同时满足以下条件的问题，才适合立即修改：

1. 影响明确。
2. 修复范围小。
3. 不改变业务语义。
4. 可以验证。
5. 不需要数据库破坏性迁移。
6. 不需要产品决策。
7. 不会影响真实用户数据。

---

# Roadmap Only

以下问题默认只进入 roadmap，不要直接动手，除非已经非常明确：

- 大范围架构重构
- 数据库 schema 大改
- Plaid sync 逻辑重写
- 预算系统重写
- 金额模型迁移
- 分类系统重构
- 引入新状态管理库
- 引入新 ORM
- 引入新测试框架
- 大规模文件移动
