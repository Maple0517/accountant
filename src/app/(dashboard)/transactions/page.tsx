'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import {
  AI_CLASSIFIED_TAG,
  AI_PENDING_TAG,
  PLAID_FALLBACK_TAG,
} from '@/lib/plaid/classification'
import type { Category, Transaction } from '@/types'

type TransactionFilter = {
  search: string
  sourceOrAccount: string
  category: string
  currency: string
  dateFrom: string
  dateTo: string
}

type TransactionGroupBy = 'date' | 'category'

type AiClassificationJob = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
  total_count: number
  pending_count: number
  completed_count: number
  failed_count: number
  error_message?: string | null
}

type TransactionWithRelations = Transaction & {
  categories?: Pick<
    Category,
    'id' | 'name' | 'name_zh' | 'icon' | 'color' | 'is_excluded_from_budget'
  > | null
  accounts?: TransactionAccountRelation | null
}

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

type AccountFilterOption = {
  id: string
  label: string
  institutionName?: string | null
  accountName?: string | null
  mask?: string | null
  type?: string | null
}

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

type SimilarCategorySuggestion = {
  transactionId: string
  categoryId: string
  categoryName: string
  similarCount: number
}

function isActiveAiJob(job: AiClassificationJob | null): job is AiClassificationJob {
  return job?.status === 'queued' || job?.status === 'running'
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stripAutomaticClassificationTags(tags: Transaction['tags']) {
  return (Array.isArray(tags) ? tags : []).filter(
    (tag) =>
      tag !== AI_CLASSIFIED_TAG &&
      tag !== AI_PENDING_TAG &&
      tag !== PLAID_FALLBACK_TAG
  )
}

function getCategoryButtonStyle(category: Category, selected: boolean) {
  const color = category.color || '#607d8b'
  return {
    borderColor: selected ? color : `${color}55`,
    background: selected
      ? `linear-gradient(135deg, ${color}4d, ${color}1f)`
      : `${color}14`,
    color: 'var(--text-primary)',
    boxShadow: selected ? `0 0 0 1px ${color} inset` : 'none',
  }
}

function formatAccountSourceLabel(account: TransactionAccountRelation) {
  const institutionName = account.plaid_items?.institution_name
  const accountName =
    account.official_name ||
    account.name ||
    account.subtype ||
    account.type ||
    'Account'
  const mask = account.mask ? ` ••••${account.mask}` : ''

  if (account.is_manual) {
    return `Manual · ${accountName}${mask}`
  }

  if (institutionName) {
    return `${institutionName} · ${accountName}${mask}`
  }

  return `${accountName}${mask}`
}

const CATEGORY_ICONS = ['🍔', '🚗', '🛍️', '🎬', '💡', '🏥', '📚', '✈️', '💰', '🏠', '💻', '🎮']
const CATEGORY_COLORS = ['#ff9800', '#2196f3', '#e91e63', '#9c27b0', '#4caf50', '#00bcd4', '#f44336', '#607d8b']

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<TransactionWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshingAi, setRefreshingAi] = useState(false)
  const [aiRefreshStatus, setAiRefreshStatus] = useState<string | null>(null)
  const [aiJob, setAiJob] = useState<AiClassificationJob | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [accountOptions, setAccountOptions] = useState<AccountFilterOption[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [groupBy, setGroupBy] = useState<TransactionGroupBy>('date')
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null)
  const [savingCategory, setSavingCategory] = useState(false)
  const [categorySaveStatus, setCategorySaveStatus] = useState<{
    transactionId: string
    message: string
  } | null>(null)
  const [similarSuggestion, setSimilarSuggestion] =
    useState<SimilarCategorySuggestion | null>(null)
  const [filters, setFilters] = useState<TransactionFilter>({
    search: '',
    sourceOrAccount: 'all',
    category: 'all',
    currency: 'all',
    dateFrom: '',
    dateTo: '',
  })

  const supabase = useMemo(() => createClient(), [])

  const fetchTransactions = useCallback(
    async (isMounted = true) => {
      let query = supabase
        .from('transactions')
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
        .order('date', { ascending: false })
        .limit(200)

      if (filters.search) {
        query = query.or(
          `merchant_name.ilike.%${filters.search}%,description.ilike.%${filters.search}%`
        )
      }
      if (filters.sourceOrAccount === 'manual') {
        query = query.eq('source', 'manual')
      } else if (filters.sourceOrAccount === 'receipt') {
        query = query.eq('source', 'receipt')
      } else if (filters.sourceOrAccount.startsWith('account:')) {
        query = query.eq(
          'account_id',
          filters.sourceOrAccount.slice('account:'.length)
        )
      }
      if (filters.category === 'uncategorized') {
        query = query.is('category_id', null)
      } else if (filters.category !== 'all') {
        query = query.eq('category_id', filters.category)
      }
      if (filters.currency !== 'all') {
        query = query.eq('iso_currency_code', filters.currency)
      }
      if (filters.dateFrom) {
        query = query.gte('date', filters.dateFrom)
      }
      if (filters.dateTo) {
        query = query.lte('date', filters.dateTo)
      }

      const { data, error } = await query

      if (!isMounted) return

      if (error) {
        console.error('Error fetching transactions:', error)
      } else {
        const nextTransactions = (data || []) as TransactionWithRelations[]
        setTransactions(nextTransactions)
        setEditingTransactionId((current) =>
          current && nextTransactions.some((tx) => tx.id === current)
            ? current
            : null
        )
      }

      setLoading(false)
    },
    [filters, supabase]
  )

  const fetchCategories = useCallback(async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('Error fetching categories:', error)
    } else {
      setCategories((data || []) as Category[])
    }

    setCategoriesLoading(false)
  }, [supabase])

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

    setAccountOptions(
      ((data || []) as TransactionAccountRelation[]).map((account) => ({
        id: account.id || '',
        label: formatAccountSourceLabel(account),
        institutionName: account.plaid_items?.institution_name ?? null,
        accountName: account.name ?? account.official_name ?? null,
        mask: account.mask ?? null,
        type: account.type ?? null,
      })).filter((account) => account.id)
    )
  }, [supabase])

  useEffect(() => {
    let isMounted = true

    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTransactions(isMounted)
    fetchCategories()
    fetchAccountFilters()

    return () => {
      isMounted = false
    }
  }, [fetchAccountFilters, fetchCategories, fetchTransactions])

  const processAiQueue = useCallback(
    async (jobId: string) => {
      setRefreshingAi(true)

      try {
        let keepProcessing = true

        while (keepProcessing) {
          const response = await fetch(
            '/api/plaid/ai-classification-jobs/process',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ job_id: jobId, limit: 20 }),
            }
          )
          const data = await response.json()

          if (!response.ok) {
            if (data.retryable) {
              setAiRefreshStatus(`${data.error}. Retrying shortly...`)
              await delay(10000)
              continue
            }

            throw new Error(data.error || 'Failed to process AI queue')
          }

          const nextJob = data.job as AiClassificationJob | null
          if (nextJob) {
            setAiJob(nextJob)
            setAiRefreshStatus(
              `AI queue: ${nextJob.completed_count}/${nextJob.total_count} done, ${nextJob.pending_count} pending, ${nextJob.failed_count} failed.`
            )
            keepProcessing = isActiveAiJob(nextJob)
          } else {
            keepProcessing = false
          }

          await fetchTransactions()
        }
      } catch (error) {
        console.error('Failed to process AI queue:', error)
        setAiRefreshStatus(
          error instanceof Error ? error.message : 'Failed to process AI queue'
        )
      } finally {
        setRefreshingAi(false)
      }
    },
    [fetchTransactions]
  )

  const fetchLatestAiJob = useCallback(async () => {
    try {
      const response = await fetch('/api/plaid/ai-classification-jobs')
      const data = await response.json()

      if (data.queue_unavailable) {
        setAiJob(null)
        setAiRefreshStatus(data.error || 'AI queue is not available yet.')
        return
      }

      if (!response.ok) {
        setAiRefreshStatus(data.error || 'Failed to load AI queue')
        return
      }

      const job = data.job as AiClassificationJob | null
      setAiJob(job)

      if (isActiveAiJob(job)) {
        setAiRefreshStatus(
          `AI queue: ${job.completed_count}/${job.total_count} done, ${job.pending_count} pending, ${job.failed_count} failed.`
        )
        processAiQueue(job.id)
      }
    } catch (error) {
      console.warn('Failed to load AI queue:', error)
      setAiRefreshStatus(
        error instanceof Error ? error.message : 'Failed to load AI queue'
      )
    }
  }, [processAiQueue])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLatestAiJob()
  }, [fetchLatestAiJob])

  const handleRefreshAiClassification = async () => {
    setRefreshingAi(true)
    setAiRefreshStatus(null)

    try {
      const response = await fetch('/api/plaid/ai-classification-jobs', {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create AI queue')
      }

      const job = data.job as AiClassificationJob
      setAiJob(job)

      if (job.total_count === 0) {
        setAiRefreshStatus('No pending AI classifications.')
      } else {
        setAiRefreshStatus(
          `AI queue started: ${job.total_count} transaction${job.total_count === 1 ? '' : 's'} queued.`
        )
        await processAiQueue(job.id)
      }
    } catch (error) {
      console.error('Failed to create AI queue:', error)
      setAiRefreshStatus(
        error instanceof Error ? error.message : 'Failed to create AI queue'
      )
    } finally {
      if (!isActiveAiJob(aiJob)) {
        setRefreshingAi(false)
      }
    }
  }

  const handleCategorySave = async (
    transactionId: string,
    categoryId: string,
    applyMode: 'single' | 'similar' = 'single'
  ) => {
    setSavingCategory(true)
    setCategorySaveStatus(null)

    try {
      const response = await fetch(`/api/transactions/${transactionId}/category`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: categoryId, apply_mode: applyMode }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update category')
      }

      const updatedCategory = data.transaction?.categories as
        | Pick<
            Category,
            'id' | 'name' | 'name_zh' | 'icon' | 'color' | 'is_excluded_from_budget'
          >
        | undefined
      const categoryName =
        updatedCategory?.name_zh ||
        updatedCategory?.name ||
        categories.find((category) => category.id === categoryId)?.name_zh ||
        categories.find((category) => category.id === categoryId)?.name ||
        'Selected category'

      setEditingTransactionId(null)

      if (applyMode === 'similar') {
        setCategorySaveStatus({
          transactionId,
          message: `已将 ${categoryName} 同步到 ${data.updated_count || 0} 笔同名交易。`,
        })
        setSimilarSuggestion(null)
        await fetchTransactions()
      } else {
        setTransactions((current) =>
          current.map((tx) =>
            tx.id === transactionId
              ? {
                  ...tx,
                  category_id: categoryId,
                  tags: stripAutomaticClassificationTags(tx.tags),
                  categories: updatedCategory || tx.categories,
                }
              : tx
          )
        )

        if ((data.similar_count || 0) > 0) {
          setSimilarSuggestion({
            transactionId,
            categoryId,
            categoryName,
            similarCount: data.similar_count,
          })
          setCategorySaveStatus({
            transactionId,
            message: `已改为 ${categoryName}。`,
          })
        } else {
          setSimilarSuggestion(null)
          setCategorySaveStatus({
            transactionId,
            message: `已改为 ${categoryName}。`,
          })
        }
      }
    } catch (error) {
      console.error('Failed to update category:', error)
      setCategorySaveStatus({
        transactionId,
        message:
          error instanceof Error ? error.message : 'Failed to update category',
      })
    } finally {
      setSavingCategory(false)
    }
  }

  const handleCreateCategory = async (
    transactionId: string,
    name: string,
    icon: string,
    color: string
  ) => {
    try {
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, icon, color, type: 'expense' }),
      })
      const newCategory = await response.json()
      if (!response.ok) throw new Error(newCategory.error || 'Failed to create category')

      setCategories((prev) => [newCategory as Category, ...prev])
      await handleCategorySave(transactionId, newCategory.id)
    } catch (error) {
      console.error('Failed to create category:', error)
      setCategorySaveStatus({
        transactionId,
        message: error instanceof Error ? error.message : 'Failed to create category',
      })
    }
  }

  const transactionsGroupedByDate = useMemo(
    () =>
      transactions.reduce(
        (groups, tx) => {
          const date = tx.date
          if (!groups[date]) groups[date] = []
          groups[date].push(tx)
          return groups
        },
        {} as Record<string, TransactionWithRelations[]>
      ),
    [transactions]
  )

  const transactionsGroupedByCategory = useMemo(() => {
    const categorySortMap = new Map(
      categories.map((category) => [category.id, category.sort_order ?? 0])
    )
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

  const hasTransactions = transactions.length > 0

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (dateStr === today.toISOString().split('T')[0]) return 'Today'
    if (dateStr === yesterday.toISOString().split('T')[0]) return 'Yesterday'

    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }

  const renderTransactionItem = (tx: TransactionWithRelations) => (
    <TransactionItem
      key={tx.id}
      transaction={tx}
      categories={categories}
      categoriesLoading={categoriesLoading}
      isEditing={editingTransactionId === tx.id}
      savingCategory={savingCategory}
      statusMessage={
        categorySaveStatus?.transactionId === tx.id
          ? categorySaveStatus.message
          : null
      }
      similarSuggestion={
        similarSuggestion?.transactionId === tx.id ? similarSuggestion : null
      }
      onToggleCategoryPicker={() => {
        setCategorySaveStatus(null)
        setSimilarSuggestion(null)
        setEditingTransactionId((current) => (current === tx.id ? null : tx.id))
      }}
      onSaveCategory={(categoryId) => handleCategorySave(tx.id, categoryId)}
      onApplySimilar={(suggestion) =>
        handleCategorySave(
          suggestion.transactionId,
          suggestion.categoryId,
          'similar'
        )
      }
      onDismissSimilar={() => setSimilarSuggestion(null)}
      onCreateCategory={(name, icon, color) =>
        handleCreateCategory(tx.id, name, icon, color)
      }
    />
  )

  return (
    <div className="transactions-page">
      <div className="page-header">
        <div>
          <h1>Transactions</h1>
          <p className="text-secondary">
            {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleRefreshAiClassification}
          disabled={refreshingAi || isActiveAiJob(aiJob)}
          title="Queue all pending Plaid fallback classifications for AI"
        >
          {refreshingAi || isActiveAiJob(aiJob)
            ? 'Processing AI...'
            : '✨ Queue AI Refresh'}
        </button>
      </div>

      {(aiRefreshStatus || aiJob) && (
        <div className="ai-refresh-status">
          <span>{aiRefreshStatus}</span>
          {aiJob && (
            <span>
              Total {aiJob.total_count} · Pending {aiJob.pending_count} · Done{' '}
              {aiJob.completed_count} · Failed {aiJob.failed_count}
            </span>
          )}
        </div>
      )}

      <div className="card filters-bar">
        <div className="filter-group">
          <input
            type="text"
            className="input"
            placeholder="🔍 Search merchant or description..."
            value={filters.search}
            onChange={(e) =>
              setFilters((f) => ({ ...f, search: e.target.value }))
            }
          />
        </div>
        <div className="filter-row">
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
          <select
            className="input"
            value={filters.category}
            onChange={(e) =>
              setFilters((f) => ({ ...f, category: e.target.value }))
            }
          >
            <option value="all">All Categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.icon || '📦'} {category.name_zh || category.name}
              </option>
            ))}
            <option value="uncategorized">📦 Uncategorized</option>
          </select>
          <select
            className="input"
            value={filters.currency}
            onChange={(e) =>
              setFilters((f) => ({ ...f, currency: e.target.value }))
            }
          >
            <option value="all">All Currencies</option>
            <option value="USD">$ USD</option>
            <option value="CNY">¥ CNY</option>
          </select>
          <input
            type="date"
            className="input"
            value={filters.dateFrom}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dateFrom: e.target.value }))
            }
            placeholder="From"
          />
          <input
            type="date"
            className="input"
            value={filters.dateTo}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dateTo: e.target.value }))
            }
            placeholder="To"
          />
        </div>
        <div className="view-toggle-row">
          <span className="text-secondary">Group by</span>
          <div className="segmented-control" aria-label="Group transactions by">
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
      </div>

      {loading ? (
        <div className="loading-state">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card skeleton-card">
              <div className="skeleton skeleton-line" style={{ width: '60%' }} />
              <div className="skeleton skeleton-line" style={{ width: '30%' }} />
            </div>
          ))}
        </div>
      ) : !hasTransactions ? (
        <div className="card empty-state">
          <span className="empty-icon">📭</span>
          <h3>No transactions yet</h3>
          <p className="text-secondary">
            Connect a bank account or add a manual transaction to get started.
          </p>
        </div>
      ) : (
        <div className="transaction-groups">
          {groupBy === 'date'
            ? Object.entries(transactionsGroupedByDate).map(([date, txs]) => {
                const dayTotal = txs.reduce(
                  (sum, tx) => sum + Number(tx.amount),
                  0
                )
                return (
                  <div key={date} className="transaction-group">
                    <div className="group-header">
                      <span className="group-date">{formatDate(date)}</span>
                      <span
                        className={`group-total ${dayTotal <= 0 ? 'income' : 'expense'}`}
                      >
                        {formatCurrency(
                          -dayTotal,
                          txs[0]?.iso_currency_code || 'USD'
                        )}
                      </span>
                    </div>
                    <div className="card transaction-list-card">
                      {txs.map(renderTransactionItem)}
                    </div>
                  </div>
                )
              })
            : transactionsGroupedByCategory.map((group) => (
                <div key={group.key} className="transaction-group">
                  <div className="group-header">
                    <span className="group-date">
                      <span
                        className="group-category-icon"
                        style={
                          group.categoryColor
                            ? { color: group.categoryColor }
                            : undefined
                        }
                      >
                        {group.categoryIcon}
                      </span>{' '}
                      {group.categoryName}
                      <span className="group-count">
                        {' '}
                        · {group.transactions.length} transaction
                        {group.transactions.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span
                      className={`group-total ${group.total <= 0 ? 'income' : 'expense'}`}
                    >
                      {formatCurrency(
                        -group.total,
                        group.transactions[0]?.iso_currency_code || 'USD'
                      )}
                    </span>
                  </div>
                  <div className="card transaction-list-card">
                    {group.transactions.map(renderTransactionItem)}
                  </div>
                </div>
              ))}
        </div>
      )}
    </div>
  )
}

function TransactionItem({
  transaction: tx,
  categories,
  categoriesLoading,
  isEditing,
  savingCategory,
  statusMessage,
  similarSuggestion,
  onToggleCategoryPicker,
  onSaveCategory,
  onApplySimilar,
  onDismissSimilar,
  onCreateCategory,
}: {
  transaction: TransactionWithRelations
  categories: Category[]
  categoriesLoading: boolean
  isEditing: boolean
  savingCategory: boolean
  statusMessage: string | null
  similarSuggestion: SimilarCategorySuggestion | null
  onToggleCategoryPicker: () => void
  onSaveCategory: (categoryId: string) => void
  onApplySimilar: (suggestion: SimilarCategorySuggestion) => void
  onDismissSimilar: () => void
  onCreateCategory: (name: string, icon: string, color: string) => void
}) {
  const amount = Number(tx.amount)
  const isIncome = amount < 0
  const displayAmount = -amount
  const categoryIcon = tx.categories?.icon || '📦'
  const categoryName = tx.categories?.name_zh || tx.categories?.name || 'Uncategorized'
  const merchantName = tx.merchant_name || tx.description
  const accountLabel = tx.accounts ? formatAccountSourceLabel(tx.accounts) : null
  const tags = Array.isArray(tx.tags) ? tx.tags : []
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [selectedNewIcon, setSelectedNewIcon] = useState(CATEGORY_ICONS[0])
  const [selectedNewColor, setSelectedNewColor] = useState(CATEGORY_COLORS[5])

  let classificationStatus: string | null = null
  if (tags.includes(AI_PENDING_TAG) || tags.includes(PLAID_FALLBACK_TAG)) {
    classificationStatus = 'AI Pending'
  } else if (tags.includes(AI_CLASSIFIED_TAG)) {
    classificationStatus = 'AI'
  }

  const metaParts: string[] = []

  if (accountLabel) {
    metaParts.push(accountLabel)
  }

  if (classificationStatus) {
    metaParts.push(classificationStatus)
  }

  if (tx.source === 'receipt') {
    metaParts.push('Receipt')
  } else if (tx.source === 'manual' && !accountLabel) {
    metaParts.push('Manual')
  }
  if (tx.pending) {
    metaParts.push('Pending')
  }
  const metaText = metaParts.join(' · ')

  return (
    <div className="transaction-item">
      <div className="tx-row-main">
        <div className="tx-icon">{categoryIcon}</div>
        <div className="tx-details">
          <span className="tx-merchant">{merchantName}</span>
          {metaText && <span className="tx-meta">{metaText}</span>}
        </div>
        <button
          type="button"
          className="tx-category-pill"
          style={getCategoryButtonStyle(
            (tx.categories || {
              id: tx.category_id || 'uncategorized',
              name: 'Uncategorized',
              user_id: '',
              type: 'expense',
              sort_order: 0,
              created_at: '',
            }) as Category,
            true
          )}
          aria-expanded={isEditing}
          aria-label={`Change category for ${merchantName}`}
          onClick={onToggleCategoryPicker}
        >
          <span className="tx-category-pill-icon">{categoryIcon}</span>
          <span className="tx-category-pill-label">{categoryName}</span>
        </button>
        <div className={`tx-amount ${isIncome ? 'income' : 'expense'}`}>
          {formatCurrency(displayAmount, tx.iso_currency_code || 'USD')}
        </div>
      </div>
      {isEditing && (
        <div className="tx-category-popover">
          <div className="tx-category-popover-header">
            <span>Pick a category</span>
            {savingCategory && <span>Saving...</span>}
          </div>
          {categoriesLoading ? (
            <p className="text-secondary">Loading categories...</p>
          ) : (
            <div className="tx-category-options">
              {categories.map((category) => {
                const isSelected = category.id === tx.category_id
                return (
                  <button
                    key={category.id}
                    type="button"
                    className={`category-chip ${isSelected ? 'selected' : ''}`}
                    style={getCategoryButtonStyle(category, isSelected)}
                    disabled={savingCategory}
                    onClick={() => onSaveCategory(category.id)}
                  >
                    <span className="category-chip-icon">{category.icon || '📦'}</span>
                    <span className="category-chip-label">
                      {category.name_zh || category.name}
                    </span>
                    {category.is_excluded_from_budget && (
                      <span className="category-chip-badge">不计入预算</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          <div className="new-category-section">
            {showNewCategoryForm ? (
              <div className="new-category-form">
                <input
                  type="text"
                  className="input new-category-input"
                  placeholder="New category name..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newCategoryName.trim()) {
                      onCreateCategory(newCategoryName.trim(), selectedNewIcon, selectedNewColor)
                      setNewCategoryName('')
                      setShowNewCategoryForm(false)
                    }
                  }}
                  autoFocus
                />
                <div className="new-category-icons">
                  {CATEGORY_ICONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      className={`icon-option ${selectedNewIcon === icon ? 'selected' : ''}`}
                      onClick={() => setSelectedNewIcon(icon)}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
                <div className="new-category-colors">
                  {CATEGORY_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-option ${selectedNewColor === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setSelectedNewColor(color)}
                    />
                  ))}
                </div>
                <div className="new-category-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!newCategoryName.trim() || savingCategory}
                    onClick={() => {
                      onCreateCategory(newCategoryName.trim(), selectedNewIcon, selectedNewColor)
                      setNewCategoryName('')
                      setShowNewCategoryForm(false)
                    }}
                  >
                    {savingCategory ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setShowNewCategoryForm(false)
                      setNewCategoryName('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="new-category-toggle"
                onClick={() => {
                  setShowNewCategoryForm(true)
                  setSelectedNewIcon(CATEGORY_ICONS[0])
                  setSelectedNewColor(CATEGORY_COLORS[5])
                }}
              >
                + New Category
              </button>
            )}
          </div>
        </div>
      )}
      {(statusMessage || similarSuggestion) && (
        <div className="inline-similar-suggestion">
          <div className="similar-suggestion-copy">
            {similarSuggestion ? (
              <span className="similar-suggestion-text">
                已改为 <strong>{similarSuggestion.categoryName}</strong>，是否同步到{' '}
                {similarSuggestion.similarCount} 笔同名交易？
              </span>
            ) : statusMessage && (
              <span className="category-save-status">{statusMessage}</span>
            )}
          </div>
          {similarSuggestion && (
            <div className="similar-suggestion-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingCategory}
                onClick={() => onApplySimilar(similarSuggestion)}
              >
                同步同名
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onDismissSimilar}
              >
                仅此一笔
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
