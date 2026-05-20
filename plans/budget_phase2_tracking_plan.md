# Budget Phase 2 执行追踪

## 标题与目标

这是 Budget Phase 2 的长期执行追踪文档。

目标：基于已完成的 Phase 1，继续完成 Budget 页面、API、service、adapter、test 的稳定化，并将本文件作为唯一进度面板持续更新。

---

## Overall status

- 当前阶段状态：Done
- 当前正在做的 step：Completed
- 上次更新时间：2026-05-20 Asia/Shanghai
- 下一步动作：Budget Phase 2 已完成，后续如继续推进可进入下一阶段功能扩展或删除冗余旧逻辑

---

## Step-by-step checklist

### Step 1 — 稳定类型边界与现状基线

- 状态：Done

#### Task list
- [x] 盘点当前 Budget 数据流：`/budgets page → /api/budget/monthly-summary → budget.service → adapter → engine`
- [x] 找出前端重复定义的预算类型
- [x] 决定统一类型出口，避免 UI 自己维护一份 summary 类型
- [x] 记录当前页面行为基线：显示哪些分类、编辑后如何刷新、错误如何表现

#### Implementation notes
- 将 `/Users/maple/Documents/accountant/src/app/(dashboard)/budgets/page.tsx` 中本地定义的 `CategoryBudgetSummary` 和 `MonthlyBudgetSummary` 替换为共享类型来源。
- 保持 UI 样式和 API 字段结构不变，只收紧类型边界。
- 确认 `visibleCategories` 当前行为是否作为 Phase 2 的默认基线保留。

#### Done criteria
- Budget 页面不再手写自己的 summary 类型。
- 服务端返回结构和前端消费结构只有一个权威定义。
- 当前页面行为基线已记录。

#### Progress log
- [2026-05-20] 创建追踪文件并将 Step 1 标记为 In Progress。
- [2026-05-20] 已确认当前数据流为 budgets page -> monthly-summary API -> budget.service -> adapter -> engine。
- [2026-05-20] 已移除预算页本地重复 summary 类型，统一改为复用 `@/modules/budget/budget.types`。
- [2026-05-20] 已记录当前页面行为基线：仅显示 `baseBudget > 0 || actualSpend > 0` 的分类；编辑成功后重新请求 summary；失败时当前仅控制台报错。

---

### Step 2 — 收紧 service / API 输入校验

- 状态：Done

#### Task list
- [x] 补强 `month` 校验，不只校验格式，还校验月份范围
- [x] 为 `updateCategoryBudget` 增加 category ownership 校验
- [x] 统一 service 抛错语义
- [x] 统一 API route 的 400 / 401 / 404 / 500 映射
- [x] 明确非法请求时前端应如何表现

#### Implementation notes
- 在 `budget.service.ts` 中升级 month 校验，并在预算更新前确认分类属于当前用户。
- 在 `/api/budget/monthly-summary` 与 `/api/budget/category-budget` 中稳定映射业务错误与输入错误。
- 前端保持“保存成功后重新拉取 summary”的模式，不做前端派生值 patch。

#### Done criteria
- 非法 `month`、非法 `amount`、错误 `categoryId` 会被稳定拒绝。
- API 错误码与错误语义一致、可预测。

#### Progress log
- [2026-05-20] Step 2 已开始，准备收紧 service / API 校验边界。
- [2026-05-20] 已将 month 校验从仅格式检查升级为合法月份检查，拒绝 `YYYY-00` / `YYYY-13`。
- [2026-05-20] 已为 `updateCategoryBudget` 增加 category ownership 校验，仅允许更新当前用户分类。
- [2026-05-20] 已统一 budget API 的错误映射：输入错误返回 400，分类不存在返回 404，未登录返回 401。
- [2026-05-20] 已确认前端非法请求仍采用失败后不 patch 派生值、等待后端 summary 重新拉取的模式。

---

### Step 3 — 修正 adapter / repository 的真实数据口径

- 状态：Done

#### Task list
- [x] 确认当前系统里 transaction amount 的真实语义
- [x] 对比 dashboard 与 budget 当前口径是否一致
- [x] 明确 adapter 是否应该负责金额归一化
- [x] 检查 category 缺失、category type 冲突时的处理方式
- [x] 在注释中写清楚 adapter 的职责边界

#### Implementation notes
- 审查 budget adapter 与 dashboard 页面中的金额符号口径。
- adapter 负责将数据库交易记录转换为 BudgetEngine 的统一 domain 输入。
- repository 继续只负责读写，不做预算计算。

#### Done criteria
- adapter 对交易金额与 type 的转换规则清晰且唯一。
- engine 不再隐式依赖数据库历史符号习惯。

#### Progress log
- [2026-05-20] 已比对 dashboard、transactions、analytics、Notion sync、Plaid sync 的实现，确认当前系统主口径为负数=expense、正数=income。
- [2026-05-20] 已确认 budget adapter 之前与其他模块存在口径冲突：engine 用 `Math.abs(tx.amount)` 掩盖了问题，但 adapter 仍缺少显式归一化职责。
- [2026-05-20] 已将 amount sign normalization 固化在 `adaptTransactions`：expense 一律转为负数，income 一律转为正数，engine 不再依赖数据库符号猜测。
- [2026-05-20] 已保留 category 缺失时 fallback 为 `expense` 的策略，并在注释中写明其目的：允许未识别分类的支出继续参与预算过滤。

---

### Step 4 — 补齐测试覆盖

- 状态：Done

#### Task list
- [x] 保留并扩展 `budget-engine.test.ts`
- [x] 新增 service 层测试
- [x] 为 `updateCategoryBudget` 增加 ownership / negative amount / invalid month 用例
- [x] 为 monthly summary 增加非法 month 用例
- [x] 视成本决定是否补 route 级测试

#### Implementation notes
- 继续使用现有测试基建，优先增加 service 层测试，再考虑 route 测试。
- engine 测试补充边界条件与非法输入行为。

#### Done criteria
- 预算模块不仅 engine 有测试，service/API 边界也有基本保障。
- 常见非法输入被测试锁住。

#### Progress log
- [2026-05-20] 已扩展 `budget-engine.test.ts`，补充月边界、空 categoryId、未知 categoryId 等用例。
- [2026-05-20] 已新增 `test/budget-service.test.ts`，覆盖 invalid month、negative amount、category ownership、合法 upsert 参数。
- [2026-05-20] 本轮未单独新增 route 级测试，原因是当前 route 主要做 service 错误映射，已优先通过 service 测试锁住核心边界。

---

### Step 5 — 收尾 Budget 页面交互细节

- 状态：Done

#### Task list
- [x] 修正 `EditInput` 的 ref 用法
- [x] 补上保存失败的可见反馈
- [x] 确认保存后只通过 re-fetch 更新 UI
- [x] 确认页面没有重新计算 `spent` / `remaining` / `percentUsed`
- [x] 最后再做一次手工验证

#### Implementation notes
- 将预算页中的编辑输入改为标准 ref 用法。
- 增加保存失败的用户可见提示。
- 保持 UI 派生值全部来自后端 summary。

#### Done criteria
- 编辑交互可靠。
- 保存失败可见。
- 页面不再自行计算核心预算派生值。

#### Progress log
- [2026-05-20] 已在预算页增加 `saveError` 状态，并将预算保存失败展示为用户可见错误提示。
- [2026-05-20] 已确认预算更新后仍只通过重新请求 monthly summary 更新 UI，没有在前端手算或 patch `remaining` / `percentUsed` / totals。
- [2026-05-20] 已复核预算页当前派生值来源：进度条宽度、剩余金额、总计卡片均直接来自 summary，不再自建核心预算 source of truth。
- [2026-05-20] 已完成本轮手工代码级验证，并通过 `npm test` 作为回归确认。

---

## Decision log

- [2026-05-20] 追踪文件路径固定为 `/Users/maple/Documents/accountant/plans/budget_phase2_tracking_plan.md`，作为唯一进度面板持续维护。
- [2026-05-20] 原始蓝图 `/Users/maple/Documents/accountant/plans/budget_module_incremental_refactor_plan_for_codex.md` 保留，不覆盖。
- [2026-05-20] Phase 2 默认执行顺序固定为 Step 1 → Step 2 → Step 3 → Step 4 → Step 5。
- [2026-05-20] 共享 month 校验继续放在 service 层，route 仅负责请求体解析与错误码映射。
- [2026-05-20] category ownership 校验放在 service 层，通过当前用户分类列表进行确认，再调用 repository upsert。
- [2026-05-20] transaction amount 的持久化口径以现有仓库实现为准：负数代表支出、正数代表收入；adapter 负责对 BudgetEngine 做归一化。
- [2026-05-20] Step 4 先补 service 测试而非 route 测试，避免为薄路由层引入过重的 mock 成本。

---

## Verification log

- [2026-05-20] 已创建追踪文件，结构包括：Overall status、5 个 step、Decision log、Verification log。
- [2026-05-20] 已将 Step 1 标记为 In Progress，符合执行约定。
- [2026-05-20] Step 1 完成：预算页共享类型边界已统一，当前页面行为基线已记录。
- [2026-05-20] Step 2 完成：service / API 输入校验已收紧，非法 month、非法 amount、错误 categoryId 已有稳定错误语义。
- [2026-05-20] Step 3 完成：adapter 数据口径已与仓库其他消费方对齐，金额归一化职责已明确并写入注释。
- [2026-05-20] Step 4 完成：budget engine 与 service 关键边界已有测试覆盖，非法 month / amount / category ownership 已被测试锁住。
- [2026-05-20] Step 5 完成：预算页交互收尾完成，保存失败可见，UI 继续仅消费后端 summary，Budget Phase 2 全部完成。
