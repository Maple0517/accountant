# 02 - 交易页增加按分类显示

## 目标

在交易页面增加一个视图切换：

```text
Group by: [Date] [Category]
```

默认仍然是 Date，避免改变现有用户习惯。切到 Category 后，交易按分类分组展示。

## 状态设计

在 `src/app/(dashboard)/transactions/page.tsx` 中新增：

```ts
type TransactionGroupBy = 'date' | 'category'

const [groupBy, setGroupBy] = useState<TransactionGroupBy>('date')
```

## 当前日期分组保留

当前已有：

```ts
const groupedTransactions = transactions.reduce(...)
```

建议重命名成：

```ts
const transactionsGroupedByDate = ...
```

不要删除原逻辑。

## 新增分类分组

新增 helper：

```ts
type CategoryTransactionGroup = {
  key: string
  categoryId: string | null
  categoryName: string
  categoryIcon: string
  categoryColor?: string | null
  sortOrder: number
  transactions: TransactionWithRelations[]
  total: number
}
```

实现：

```ts
const transactionsGroupedByCategory = useMemo(() => {
  const categorySortMap = new Map(categories.map((c) => [c.id, c.sort_order ?? 0]))
  const groupMap = new Map<string, CategoryTransactionGroup>()

  for (const tx of transactions) {
    const categoryId = tx.category_id ?? null
    const key = categoryId || 'uncategorized'
    const category = tx.categories

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        categoryId,
        categoryName: category?.name_zh || category?.name || 'Uncategorized',
        categoryIcon: category?.icon || '📦',
        categoryColor: category?.color || null,
        sortOrder: categoryId ? categorySortMap.get(categoryId) ?? 9999 : 10000,
        transactions: [],
        total: 0,
      })
    }

    const group = groupMap.get(key)!
    group.transactions.push(tx)
    group.total += Number(tx.amount)
  }

  return Array.from(groupMap.values()).sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.categoryName.localeCompare(b.categoryName)
  })
}, [transactions, categories])
```

金额展示沿用现有逻辑：

```ts
formatCurrency(-group.total, group.transactions[0]?.iso_currency_code || 'USD')
```

## UI 控件

放在 filters bar 下方或 filters row 内：

```tsx
<div className="view-toggle-row">
  <span className="text-secondary">Group by</span>
  <div className="segmented-control">
    <button
      type="button"
      className={groupBy === 'date' ? 'active' : ''}
      onClick={() => setGroupBy('date')}
    >
      Date
    </button>
    <button
      type="button"
      className={groupBy === 'category' ? 'active' : ''}
      onClick={() => setGroupBy('category')}
    >
      Category
    </button>
  </div>
</div>
```

可以复用现有 CSS 风格。如果没有 segmented-control，新增轻量 CSS 到 `src/app/globals.css`：

```css
.view-toggle-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.segmented-control {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.2rem;
  background: var(--surface);
}

.segmented-control button {
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  cursor: pointer;
}

.segmented-control button.active {
  background: var(--surface-elevated);
  color: var(--text-primary);
}
```

如果项目没有这些 CSS variables，按现有 `globals.css` 的变量名调整。

## Render 拆分建议

为了减少 `page.tsx` 的复杂度，建议把现有渲染分成两个小函数或两个小组件：

```tsx
function DateGroupedTransactions(...)
function CategoryGroupedTransactions(...)
```

但如果 Codex 判断当前文件规模还能接受，可以先在同文件中实现，避免大重构。

### Date 视图

基本保持现有渲染。

### Category 视图

结构类似：

```tsx
<div className="transaction-groups">
  {transactionsGroupedByCategory.map((group) => (
    <div key={group.key} className="transaction-group">
      <div className="group-header">
        <span className="group-date">
          {group.categoryIcon} {group.categoryName}
          <span className="text-secondary"> · {group.transactions.length} transactions</span>
        </span>
        <span className={`group-total ${group.total <= 0 ? 'income' : 'expense'}`}>
          {formatCurrency(-group.total, group.transactions[0]?.iso_currency_code || 'USD')}
        </span>
      </div>

      <div className="card transaction-list-card">
        {group.transactions.map((tx) => (
          <TransactionItem ... />
        ))}
      </div>
    </div>
  ))}
</div>
```

## 空状态

当前空状态可以复用：

```tsx
Object.keys(groupedTransactions).length === 0
```

建议改成更直接：

```ts
const hasTransactions = transactions.length > 0
```

然后：

```tsx
{loading ? ... : !hasTransactions ? empty : groupBy === 'date' ? dateView : categoryView}
```

## 排序规则

- Date 视图：沿用当前交易 query 的 date desc。
- Category 视图：先按 category sort_order，再按名称。
- 每个分类内的交易顺序不要二次排序，沿用 query 返回的 date desc。

## 与“不计入”的关系

`不计入` 是普通可选分类，所以它会出现在 Category 视图中：

```text
🚫 不计入 · 3 transactions
```

但它不应该计入 Budget summary。

## 验收标准

- 默认打开页面仍然是 Date 分组。
- 切换 Category 后，交易按分类分组。
- Uncategorized 有独立分组。
- `不计入` 有独立分组。
- 切换 groupBy 不会重新请求数据，只重组前端数组。
- 搜索/来源/币种/日期筛选后，两个视图都基于筛选后的 transactions。
