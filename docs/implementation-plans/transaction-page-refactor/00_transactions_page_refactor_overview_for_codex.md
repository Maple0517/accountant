# Accountant 交易页重构总计划

## 背景

项目：`Maple0517/accountant`

目标是在现有交易记录页面上做三件事：

1. 把交易来源里的 `Bank Sync` 改成具体的银行 + 卡/账户。
2. 增加“按分类显示”的交易视图。
3. 增加一个特殊分类：`不计入`，把分到这个分类的交易排除在 Budget 计算之外。

## 当前代码事实

请 Codex 先阅读这些文件：

- `src/app/(dashboard)/transactions/page.tsx`
- `src/types/index.ts`
- `src/lib/categories.ts`
- `src/lib/categories-db.ts`
- `src/app/api/categories/route.ts`
- `src/app/api/transactions/[id]/category/route.ts`
- `src/modules/budget/budget.types.ts`
- `src/modules/budget/budget.adapter.ts`
- `src/modules/budget/budget.engine.ts`
- `src/modules/budget/budget.repository.ts`
- `supabase/migrations/001_initial_schema.sql`
- `test/budget-engine.test.ts`

当前核心结构：

- `transactions.account_id` 已经存在。
- `transactions.category_id` 已经存在。
- `transactions.source` 当前是 `'plaid' | 'manual' | 'receipt'`。
- `accounts.plaid_item_id` 指向 `plaid_items.id`。
- `plaid_items.institution_name` 已经存银行名。
- 当前交易页只 select 了 `accounts ( name, type )`。
- 当前来源筛选里有 `Bank Sync`，对应 `source = plaid`。
- Budget domain type 已经有 `BudgetCategoryInput.isExcludedFromBudget`。
- 但当前数据库和 `Category` 类型还没有 `is_excluded_from_budget` 字段。
- `budget.adapter.ts` 当前用 `row.type !== 'expense'` 来判断是否排除预算。

## 实施顺序

建议拆成 4 个小 PR / 4 次 Codex 任务，避免一次改太多：

1. **数据模型 + 不计入分类**
   - 新增 `categories.is_excluded_from_budget`
   - 更新类型
   - 默认分类里增加 `Excluded / 不计入`
   - 更新 budget adapter，让该字段真正影响预算计算

2. **交易来源显示与筛选**
   - 交易列表中显示具体 `银行 · 卡名 ••••1234`
   - 来源筛选从 `Bank Sync` 改成具体账户列表
   - manual / receipt 仍然保留

3. **按分类显示**
   - 增加 `Group by: Date / Category`
   - 保留原来的按日期分组
   - 分类视图按 category 聚合

4. **测试与验收**
   - Budget engine / adapter 测试
   - 交易页手动 QA
   - lint / test / build

## 不要做的事

- 不要为这个任务调用 Plaid `transactions/refresh`。
- 不要改 Plaid sync 主流程。
- 不要改 webhook/cron sync 策略。
- 不要把 `不计入` 做成 `transfer` 类型来绕过预算；它应该是 `expense` 类型，但 `is_excluded_from_budget = true`。
- 不要直接删除或迁移历史交易，只通过分类改变是否计入预算。
- 不要把 `Bank Sync` 完全理解成 source 消失；数据库里 `source='plaid'` 仍然保留，只是 UI 上更具体。

## 完成后的用户体验

交易页面顶部：

```text
Transactions
Showing latest 200 transactions

[Search] [All Accounts / Chase · Freedom ••••1234 / Amex · Gold ••••1001 / Manual / Receipt]
[All Currencies] [Date From] [Date To]
Group by: [Date] [Category]
```

交易列表每一条：

```text
🍔 Starbucks
Chase · Freedom ••••1234 · AI
餐饮美食          $8.50
```

按分类显示：

```text
🍔 餐饮美食 · 12 transactions        $386.20
  Starbucks ...
  McDonald's ...

🚫 不计入 · 3 transactions           $1,200.00
  Rent ...
```

Budget 页面/预算计算：

- 分类为 `不计入` 的交易不出现在预算分类统计里。
- `不计入` 分类本身也不出现在 Budget category summary 中。
- 总预算、总花费、remaining 都不包含这些交易。

## 验收标准总览

- `npm run lint` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- 交易页不再显示泛泛的 `Bank Sync` 作为 Plaid 交易来源。
- Plaid 交易显示真实银行名 + 卡/账户名 + mask。
- 可以切换 Date / Category 视图。
- 把某笔交易改成 `不计入` 后，当月 Budget 花费减少对应金额。
- manual / receipt 交易仍可筛选和显示。
