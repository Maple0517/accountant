# 01 - 交易来源改成具体银行和卡

## 目标

把交易页里的泛泛 `Bank Sync` 改成具体的银行 + 卡/账户，例如：

```text
Chase · Freedom Unlimited ••••1234
Bank of America · Checking ••••9988
Manual
Receipt
```

注意：数据库里的 `source='plaid'` 不需要改。这里主要是 UI 展示和筛选逻辑重构。

## 当前问题

`src/app/(dashboard)/transactions/page.tsx` 里当前筛选是：

```tsx
<option value="all">All Sources</option>
<option value="plaid">🏦 Bank Sync</option>
<option value="manual">✏️ Manual</option>
<option value="receipt">📸 Receipt</option>
```

当前交易 item 的 meta 只显示 `accountName`，因为查询只拿了：

```ts
accounts ( name, type )
```

这样无法展示银行名、卡后四位、official name。

## 推荐数据结构

在 `transactions/page.tsx` 中扩展关系类型：

```ts
type TransactionAccountRelation = {
  id?: string | null
  name?: string | null
  official_name?: string | null
  type?: string | null
  subtype?: string | null
  mask?: string | null
  is_manual?: boolean | null
  plaid_items?: {
    institution_name?: string | null
    institution_id?: string | null
  } | null
}

type TransactionWithRelations = Transaction & {
  categories?: Pick<Category, 'id' | 'name' | 'name_zh' | 'icon' | 'color' | 'is_excluded_from_budget'> | null
  accounts?: TransactionAccountRelation | null
}
```

增加页面级账户筛选类型：

```ts
type AccountFilterOption = {
  id: string
  label: string
  institutionName?: string | null
  accountName?: string | null
  mask?: string | null
  type?: string | null
}
```

将 filter 中的 `source` 改成更明确的字段：

```ts
type TransactionFilter = {
  search: string
  sourceOrAccount: string
  currency: string
  dateFrom: string
  dateTo: string
}
```

可选值建议：

```ts
'all'
'manual'
'receipt'
'account:<account_id>'
```

不要用纯 account id，因为后续可能和 source 值冲突。

## Supabase 查询改法

### 交易查询

把原来的：

```ts
.select(`*, categories ( id, name, name_zh, icon, color ), accounts ( name, type )`)
```

改为：

```ts
.select(`
  *,
  categories (
    id,
    name,
    name_zh,
    icon,
    color,
    is_excluded_from_budget
  ),
  accounts (
    id,
    name,
    official_name,
    type,
    subtype,
    mask,
    is_manual,
    plaid_items (
      institution_name,
      institution_id
    )
  )
`)
```

筛选逻辑：

```ts
if (filters.sourceOrAccount === 'manual') {
  query = query.eq('source', 'manual')
} else if (filters.sourceOrAccount === 'receipt') {
  query = query.eq('source', 'receipt')
} else if (filters.sourceOrAccount.startsWith('account:')) {
  const accountId = filters.sourceOrAccount.slice('account:'.length)
  query = query.eq('account_id', accountId)
}
```

保留原来的 search、currency、dateFrom、dateTo 逻辑。

### 账户筛选选项查询

新增 `fetchAccountFilters`：

```ts
const [accountOptions, setAccountOptions] = useState<AccountFilterOption[]>([])

const fetchAccountFilters = useCallback(async () => {
  const { data, error } = await supabase
    .from('accounts')
    .select(`
      id,
      name,
      official_name,
      type,
      subtype,
      mask,
      is_manual,
      plaid_items (
        institution_name,
        institution_id
      )
    `)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching account filters:', error)
    return
  }

  setAccountOptions((data || []).map((account) => ({
    id: account.id,
    label: formatAccountSourceLabel(account),
    institutionName: account.plaid_items?.institution_name ?? null,
    accountName: account.name ?? account.official_name ?? null,
    mask: account.mask ?? null,
    type: account.type ?? null,
  })))
}, [supabase])
```

在页面初始 effect 中调用：

```ts
fetchTransactions(isMounted)
fetchCategories()
fetchAccountFilters()
```

## Label helper

在 `transactions/page.tsx` 内或抽到 `src/lib/account-labels.ts`：

```ts
function formatAccountSourceLabel(account: {
  name?: string | null
  official_name?: string | null
  type?: string | null
  subtype?: string | null
  mask?: string | null
  is_manual?: boolean | null
  plaid_items?: {
    institution_name?: string | null
  } | null
}) {
  const institutionName = account.plaid_items?.institution_name
  const accountName = account.official_name || account.name || account.subtype || account.type || 'Account'
  const mask = account.mask ? ` ••••${account.mask}` : ''

  if (account.is_manual) {
    return `Manual · ${accountName}${mask}`
  }

  if (institutionName) {
    return `${institutionName} · ${accountName}${mask}`
  }

  return `${accountName}${mask}`
}
```

交易 item meta 中优先显示这个 label：

```ts
const accountLabel = tx.accounts ? formatAccountSourceLabel(tx.accounts) : null

if (accountLabel) {
  metaParts.push(accountLabel)
}
```

这样 Plaid 交易会显示银行 + 卡，manual account 也能正常显示。

## Filter UI 改法

把 `All Sources` 改成 `All Accounts`：

```tsx
<select
  className="input"
  value={filters.sourceOrAccount}
  onChange={(e) =>
    setFilters((f) => ({ ...f, sourceOrAccount: e.target.value }))
  }
>
  <option value="all">All Accounts</option>
  {accountOptions.map((account) => (
    <option key={account.id} value={`account:${account.id}`}>
      🏦 {account.label}
    </option>
  ))}
  <option value="manual">✏️ Manual</option>
  <option value="receipt">📸 Receipt</option>
</select>
```

如果一个 receipt 交易也绑定了 account，它在 account 筛选里也会出现。这是合理的。`Receipt` option 用于按 source 筛选 receipt-created transactions。

## Edge cases

1. `institution_name` 为空：
   - 显示 account name + mask。
2. mask 为空：
   - 不显示 `••••`。
3. manual account：
   - 显示 `Manual · Cash` 或 `Manual · <account.name>`。
4. 同一家银行多张卡：
   - 靠 account name + mask 区分。
5. 没有任何 accounts：
   - 下拉只显示 `All Accounts / Manual / Receipt`。
6. 旧交易没有 account relation：
   - meta 不显示 account，不要崩溃。

## 验收标准

- 页面上不再出现 `🏦 Bank Sync` 这个文案。
- Plaid 交易行能看到具体银行和卡/账户。
- 筛选某一张卡后，只显示这张卡的交易。
- Manual/Receipt 筛选仍然可用。
- 原有搜索、日期、币种筛选不被破坏。
