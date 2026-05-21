# 03 - 增加“不计入”分类并排除 Budget

## 目标

增加一个具体分类：`不计入`。

用户把交易分类改成 `不计入` 后：

- 这笔交易仍然保留在交易记录里。
- 交易页面可以按分类看到它。
- Budget 计算不包含这笔交易。
- Budget 总花费、分类花费、remaining 都不包含它。
- 这个分类本身不出现在 Budget category summary 中。

## 设计选择

使用分类级别字段，而不是交易级别字段：

```sql
categories.is_excluded_from_budget boolean not null default false
```

原因：

- 用户需求是“具体分类里增加一个分类类似叫 不计入”。
- 当前 Budget domain type 已经有 `BudgetCategoryInput.isExcludedFromBudget`。
- 分类级别更符合 Copilot Money / Monarch 这类产品的“excluded category”心智。
- 不需要给每笔交易新增 `is_excluded`，避免和 category 产生双重来源。

## 数据库迁移

新增迁移文件，例如：

```text
supabase/migrations/010_add_excluded_budget_categories.sql
```

内容建议：

```sql
-- Add category-level budget exclusion flag.
ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS is_excluded_from_budget BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_categories_budget_exclusion
ON public.categories(user_id, is_excluded_from_budget);

-- Mark any existing manually-created excluded categories.
UPDATE public.categories
SET is_excluded_from_budget = true,
    icon = COALESCE(icon, '🚫'),
    color = COALESCE(color, '#9e9e9e')
WHERE lower(name) IN ('excluded', 'exclude', 'not counted', 'not included')
   OR name_zh IN ('不计入', '不纳入预算', '排除');

-- Seed the category for existing users that have profiles.
INSERT INTO public.categories (
  user_id,
  name,
  name_zh,
  icon,
  color,
  type,
  sort_order,
  is_excluded_from_budget
)
SELECT
  profiles.id,
  'Excluded',
  '不计入',
  '🚫',
  '#9e9e9e',
  'expense',
  999,
  true
FROM public.profiles profiles
WHERE NOT EXISTS (
  SELECT 1
  FROM public.categories c
  WHERE c.user_id = profiles.id
    AND (
      lower(c.name) = 'excluded'
      OR c.name_zh = '不计入'
      OR c.is_excluded_from_budget = true
    )
);
```

注意：这只是给已有 profile seed。新用户/没有默认分类的用户仍然要靠 app seed 逻辑兜底。

## 更新类型

`src/types/index.ts`

```ts
export type Category = {
  id: string
  user_id: string
  name: string
  name_zh?: string
  icon?: string
  color?: string
  plaid_primary?: string
  plaid_detailed?: string
  type: 'income' | 'expense' | 'transfer'
  is_excluded_from_budget?: boolean
  sort_order: number
  created_at: string
}
```

建议设为 optional，是为了兼容 Supabase 类型返回或旧测试 fixture。

## 更新默认分类

`src/lib/categories.ts`

更新 `AppCategory`：

```ts
export type AppCategory = {
  name: string
  name_zh: string
  icon: string
  color: string
  type: 'income' | 'expense' | 'transfer'
  isExcludedFromBudget?: boolean
  plaidPrimary?: string[]
}
```

在 `DEFAULT_CATEGORIES` 末尾增加：

```ts
{
  name: 'Excluded',
  name_zh: '不计入',
  icon: '🚫',
  color: '#9e9e9e',
  type: 'expense',
  isExcludedFromBudget: true,
}
```

不要给 `不计入` 配 `plaidPrimary`。否则 Plaid 自动分类可能错误地把交易放到不计入。

## 更新 categories-db

`src/lib/categories-db.ts`

### CategoryRow

```ts
export type CategoryRow = {
  id: string
  user_id: string
  name: string
  name_zh: string | null
  icon: string | null
  color: string | null
  type: 'income' | 'expense' | 'transfer'
  is_excluded_from_budget?: boolean | null
}
```

### seed 默认分类

```ts
const categoriesToInsert = DEFAULT_CATEGORIES.map((c, index) => ({
  user_id: userId,
  name: c.name,
  name_zh: c.name_zh,
  icon: c.icon,
  color: c.color,
  type: c.type,
  is_excluded_from_budget: c.isExcludedFromBudget ?? false,
  sort_order: index,
}))
```

### 兜底确保“不计入”存在

因为已有用户已经有 categories，`getUserCategories` 当前会直接 return，不会补新增默认分类。建议增加 helper：

```ts
async function ensureExcludedCategory(
  supabase: SupabaseClient,
  userId: string,
  categories: CategoryRow[],
): Promise<CategoryRow[]> {
  const existing = categories.find(
    (c) =>
      c.is_excluded_from_budget === true ||
      c.name.toLowerCase() === 'excluded' ||
      c.name_zh === '不计入'
  )

  if (existing) {
    if (!existing.is_excluded_from_budget) {
      const { data: updated } = await supabase
        .from('categories')
        .update({ is_excluded_from_budget: true })
        .eq('id', existing.id)
        .eq('user_id', userId)
        .select('*')
        .single()

      if (updated) {
        return categories.map((c) => (c.id === updated.id ? updated as CategoryRow : c))
      }
    }

    return categories
  }

  const maxSortOrder = categories.reduce(
    (max, category: any) => Math.max(max, Number(category.sort_order ?? 0)),
    0,
  )

  const { data: inserted, error } = await supabase
    .from('categories')
    .insert({
      user_id: userId,
      name: 'Excluded',
      name_zh: '不计入',
      icon: '🚫',
      color: '#9e9e9e',
      type: 'expense',
      sort_order: maxSortOrder + 1,
      is_excluded_from_budget: true,
    })
    .select('*')
    .single()

  if (error) {
    console.error('Error ensuring excluded category:', error)
    return categories
  }

  return [...categories, inserted as CategoryRow]
}
```

然后在 `getUserCategories` 中：

```ts
if (categories && categories.length > 0) {
  return ensureExcludedCategory(supabase, userId, categories as CategoryRow[])
}
```

## 更新 categories API

`src/app/api/categories/route.ts`

普通新建分类默认不排除：

```ts
const isExcludedFromBudget =
  typeof body.is_excluded_from_budget === 'boolean'
    ? body.is_excluded_from_budget
    : false
```

insert 时加入：

```ts
is_excluded_from_budget: isExcludedFromBudget,
```

目前交易页的新建分类不要传这个字段。只有默认 `不计入` 或未来 category settings 页面才设置 true。

## 更新交易页 category select

交易页 `fetchCategories` 现在 `.select('*')`，迁移后会自动拿到 `is_excluded_from_budget`。

建议 category chip 展示 `不计入` 标记：

```tsx
{category.is_excluded_from_budget && (
  <span className="category-chip-badge">Not in budget</span>
)}
```

或者中文：

```text
不计入预算
```

不要隐藏 `不计入`。它需要像普通分类一样可以被选择。

## 更新 Budget adapter

`src/modules/budget/budget.adapter.ts`

当前：

```ts
isExcludedFromBudget: row.type !== 'expense',
```

改成：

```ts
isExcludedFromBudget:
  row.type !== 'expense' || row.is_excluded_from_budget === true,
```

这样：

- income/transfer 仍然排除
- `不计入` expense 也排除

## Budget engine 是否需要改？

`budget.engine.ts` 目前已经用：

```ts
const expenseCategories = categories.filter(
  (c) => c.type === 'expense' && !c.isExcludedFromBudget
)
```

所以引擎本身不需要大改。只需要确保 adapter 传入正确值。

## 更新测试

`test/budget-engine.test.ts` 已经有 `excluded category not counted`，可以保留。

建议新增 adapter 测试文件：

```text
test/budget-adapter.test.ts
```

测试：

1. 普通 expense category:
   - `is_excluded_from_budget=false`
   - adapted `isExcludedFromBudget=false`

2. `不计入` category:
   - `type='expense'`
   - `is_excluded_from_budget=true`
   - adapted `isExcludedFromBudget=true`

3. income/transfer:
   - 即使 `is_excluded_from_budget=false`
   - adapted `isExcludedFromBudget=true`

示例：

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptCategories } from '@/modules/budget/budget.adapter'
import type { Category } from '@/types'

function makeCategory(overrides: Partial<Category>): Category {
  return {
    id: 'cat_1',
    user_id: 'user_1',
    name: 'Food',
    type: 'expense',
    sort_order: 0,
    created_at: '2026-05-01',
    ...overrides,
  }
}

test('adapter excludes category marked is_excluded_from_budget', () => {
  const [category] = adaptCategories([
    makeCategory({
      id: 'cat_excluded',
      name: 'Excluded',
      name_zh: '不计入',
      type: 'expense',
      is_excluded_from_budget: true,
    }),
  ])

  assert.equal(category.isExcludedFromBudget, true)
})
```

## 手动验收

1. 打开交易页。
2. 找一笔本月 expense。
3. 改分类为 `不计入`。
4. 刷新 Budget 页面或调用 monthly budget summary。
5. 验证：
   - 该金额不再计入总 actualSpend。
   - `不计入` 不出现在 Budget summary categories。
   - 交易页仍显示这笔交易。
   - Category 视图里能看到 `不计入` 分组。

## 重要边界

- `不计入` 是 expense 类型，不是 transfer。
- `不计入` 不应该被 AI/Plaid 自动分类命中，除非用户手动选择。
- 如果用户把同名交易批量同步到 `不计入`，这些交易都应该不计入预算。
- Notion sync 如有 category 字段，可以同步 `不计入` 这个分类名；不要因为排除预算就不同步交易。