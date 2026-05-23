'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import {
  AI_CLASSIFIED_TAG,
  AI_PENDING_TAG,
  PLAID_FALLBACK_TAG,
  stripAutomaticClassificationTags,
} from '@/lib/plaid/classification'
import type { AiClassificationJob, Category, Transaction } from '@/types'

type TransactionFilter = {
  search: string
  sourceOrAccount: string
  category: string
  currency: string
  dateFrom: string
  dateTo: string
}

type TransactionGroupBy = 'date' | 'category'


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

type RefundLinkCandidate = {
  id: string
  label: string
}

const EMPTY_LINK_CANDIDATES: RefundLinkCandidate[] = []

function isActiveAiJob(job: AiClassificationJob | null): job is AiClassificationJob {
  return job?.status === 'queued' || job?.status === 'running'
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value)
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [value, delayMs])

  return debouncedValue
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

function formatShortDate(dateStr: string) {
  const date = new Date(`${dateStr}T00:00:00`)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function formatBudgetApplication(tx: TransactionWithRelations) {
  if (!tx.budget_effective_date || tx.budget_effective_date === tx.date) {
    return null
  }

  return `Posted ${formatShortDate(tx.date)} · Applied to ${formatShortDate(tx.budget_effective_date)} budget`
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
  const [savingTransactionId, setSavingTransactionId] = useState<string | null>(null)
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
  const debouncedSearch = useDebouncedValue(filters.search, 300)
  const queryFilters = useMemo(
    () => ({
      search: debouncedSearch,
      sourceOrAccount: filters.sourceOrAccount,
      category: filters.category,
      currency: filters.currency,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    }),
    [
      debouncedSearch,
      filters.sourceOrAccount,
      filters.category,
      filters.currency,
      filters.dateFrom,
      filters.dateTo,
    ]
  )

  const fetchTransactions = useCallback(
    async (isMounted = true) => {
      let query = supabase
        .from('transactions')
        .select(`
          id,
          user_id,
          account_id,
          amount,
          iso_currency_code,
          date,
          merchant_name,
          description,
          pending,
          source,
          category_id,
          tags,
          transaction_kind,
          budget_behavior,
          linked_transaction_id,
          budget_effective_date,
          refund_match_confidence,
          refund_match_reason,
          transfer_match_status,
          transfer_match_reason,
          created_at,
          updated_at,
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
          ),
          categories (
            id,
            name,
            name_zh,
            icon,
            color,
            is_excluded_from_budget
          )
        `)
        .order('date', { ascending: false })
        .limit(200)

      if (queryFilters.search) {
        const escapedSearch = queryFilters.search.replace(/[%,]/g, '')
        query = query.or(
          `merchant_name.ilike.%${escapedSearch}%,description.ilike.%${escapedSearch}%`
        )
      }
      if (queryFilters.sourceOrAccount === 'manual') {
        query = query.eq('source', 'manual')
      } else if (queryFilters.sourceOrAccount === 'receipt') {
        query = query.eq('source', 'receipt')
      } else if (queryFilters.sourceOrAccount.startsWith('account:')) {
        query = query.eq(
          'account_id',
          queryFilters.sourceOrAccount.slice('account:'.length)
        )
      }
      if (queryFilters.category === 'uncategorized') {
        query = query.is('category_id', null)
      } else if (queryFilters.category !== 'all') {
        query = query.eq('category_id', queryFilters.category)
      }
      if (queryFilters.currency !== 'all') {
        query = query.eq('iso_currency_code', queryFilters.currency)
      }
      if (queryFilters.dateFrom) {
        query = query.gte('date', queryFilters.dateFrom)
      }
      if (queryFilters.dateTo) {
        query = query.lte('date', queryFilters.dateTo)
      }

      const { data, error } = await query

      if (!isMounted) return

      if (error) {
        console.error('Error fetching transactions:', error)
      } else {
        const nextTransactions = ((data || []) as Array<{
          accounts?: TransactionAccountRelation | TransactionAccountRelation[] | null
          categories?:
            | Pick<
                Category,
                'id' | 'name' | 'name_zh' | 'icon' | 'color' | 'is_excluded_from_budget'
              >
            | Array<
                Pick<
                  Category,
                  'id' | 'name' | 'name_zh' | 'icon' | 'color' | 'is_excluded_from_budget'
                >
              >
            | null
        }>).map((tx) => ({
          ...(tx as unknown as Transaction),
          accounts: Array.isArray(tx.accounts) ? tx.accounts[0] ?? null : tx.accounts ?? null,
          categories: Array.isArray(tx.categories) ? tx.categories[0] ?? null : tx.categories ?? null,
        })) as TransactionWithRelations[]
        setTransactions(nextTransactions)
        setEditingTransactionId((current) =>
          current && nextTransactions.some((tx) => tx.id === current)
            ? current
            : null
        )
      }

      setLoading(false)
    },
    [queryFilters, supabase]
  )

  const fetchCategories = useCallback(async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('id, user_id, name, name_zh, icon, color, type, is_excluded_from_budget, sort_order, created_at')
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
    const timeoutId = window.setTimeout(() => {
      fetchLatestAiJob()
    }, 800)

    return () => window.clearTimeout(timeoutId)
  }, [fetchLatestAiJob])

  const handleRefreshAiClassification = useCallback(async () => {
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
      setRefreshingAi(false)
    }
  }, [processAiQueue])

  const handleCategorySave = useCallback(
    async (
      transactionId: string,
      categoryId: string,
      applyMode: 'single' | 'similar' = 'single'
    ) => {
      setSavingTransactionId(transactionId)
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
        setSavingTransactionId(null)
      }
    },
    [categories, fetchTransactions]
  )

  const handleCreateCategory = useCallback(
    async (
      transactionId: string,
      name: string,
      icon: string,
      color: string
    ) => {
      try {
        setSavingTransactionId(transactionId)
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
      } finally {
        setSavingTransactionId(null)
      }
    },
    [handleCategorySave]
  )

  const handleRefundMetadataSave = useCallback(
    async (
      transactionId: string,
      payload: {
        transaction_kind?: Transaction['transaction_kind']
        linked_transaction_id?: string | null
        budget_effective_date?: string | null
      }
    ) => {
      setSavingTransactionId(transactionId)
      setCategorySaveStatus(null)

      try {
        const response = await fetch(`/api/transactions/${transactionId}/refund`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to update refund metadata')
        }

        const updated = data.transaction as TransactionWithRelations
        setTransactions((current) =>
          current.map((tx) => (tx.id === transactionId ? { ...tx, ...updated } : tx))
        )
        setCategorySaveStatus({
          transactionId,
          message: 'Refund settings saved.',
        })
      } catch (error) {
        console.error('Failed to update refund metadata:', error)
        setCategorySaveStatus({
          transactionId,
          message:
            error instanceof Error ? error.message : 'Failed to update refund metadata',
        })
      } finally {
        setSavingTransactionId(null)
      }
    },
    []
  )

  const handleSemanticsSave = useCallback(
    async (
      transactionId: string,
      payload: {
        transaction_kind?: Transaction['transaction_kind']
        budget_behavior?: Transaction['budget_behavior']
        transfer_match_status?: Transaction['transfer_match_status']
        existing_debt_payment?: boolean
      }
    ) => {
      setSavingTransactionId(transactionId)
      setCategorySaveStatus(null)

      try {
        const response = await fetch(`/api/transactions/${transactionId}/semantics`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to update transaction treatment')
        }

        const updated = data.transaction as TransactionWithRelations
        setTransactions((current) =>
          current.map((tx) => (tx.id === transactionId ? { ...tx, ...updated } : tx))
        )
        setCategorySaveStatus({
          transactionId,
          message: 'Treatment saved.',
        })
      } catch (error) {
        console.error('Failed to update transaction treatment:', error)
        setCategorySaveStatus({
          transactionId,
          message:
            error instanceof Error ? error.message : 'Failed to update treatment',
        })
      } finally {
        setSavingTransactionId(null)
      }
    },
    []
  )

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

  const linkCandidatesByTransactionId = useMemo(() => {
    if (!editingTransactionId) {
      return new Map<string, RefundLinkCandidate[]>()
    }

    const editingTransaction = transactions.find(
      (tx) => tx.id === editingTransactionId
    )
    if (!editingTransaction) {
      return new Map<string, RefundLinkCandidate[]>()
    }

    const linkCandidates = transactions
      .filter((candidate) => {
        if (candidate.id === editingTransaction.id) return false
        if (Number(candidate.amount) <= 0) return false
        if (candidate.date > editingTransaction.date) return false
        return true
      })
      .slice(0, 30)
      .map((candidate) => ({
        id: candidate.id,
        label: `${formatShortDate(candidate.date)} · ${
          candidate.merchant_name || candidate.description
        } · ${formatCurrency(
          Number(candidate.amount),
          candidate.iso_currency_code || 'USD'
        )}`,
      }))

    return new Map([[editingTransaction.id, linkCandidates]])
  }, [editingTransactionId, transactions])

  const formatDate = useCallback((dateStr: string) => {
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
  }, [])

  const handleToggleCategoryPicker = useCallback((transactionId: string) => {
    setCategorySaveStatus(null)
    setSimilarSuggestion(null)
    setEditingTransactionId((current) =>
      current === transactionId ? null : transactionId
    )
  }, [])

  const handleDismissSimilar = useCallback(() => {
    setSimilarSuggestion(null)
  }, [])

  const renderTransactionItem = useCallback(
    (tx: TransactionWithRelations) => (
      <TransactionItem
        key={tx.id}
        transaction={tx}
        linkCandidates={
          linkCandidatesByTransactionId.get(tx.id) || EMPTY_LINK_CANDIDATES
        }
        categories={categories}
        categoriesLoading={categoriesLoading}
        isEditing={editingTransactionId === tx.id}
        isSaving={savingTransactionId === tx.id}
        statusMessage={
          categorySaveStatus?.transactionId === tx.id
            ? categorySaveStatus.message
            : null
        }
        similarSuggestion={
          similarSuggestion?.transactionId === tx.id ? similarSuggestion : null
        }
        onToggleCategoryPicker={handleToggleCategoryPicker}
        onSaveCategory={handleCategorySave}
        onApplySimilar={handleCategorySave}
        onDismissSimilar={handleDismissSimilar}
        onCreateCategory={handleCreateCategory}
        onSaveRefundMetadata={handleRefundMetadataSave}
        onSaveSemantics={handleSemanticsSave}
      />
    ),
    [
      categories,
      categoriesLoading,
      categorySaveStatus,
      editingTransactionId,
      handleCategorySave,
      handleCreateCategory,
      handleDismissSimilar,
      handleRefundMetadataSave,
      handleSemanticsSave,
      handleToggleCategoryPicker,
      linkCandidatesByTransactionId,
      savingTransactionId,
      similarSuggestion,
    ]
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

const TransactionItem = memo(function TransactionItem({
  transaction: tx,
  linkCandidates,
  categories,
  categoriesLoading,
  isEditing,
  isSaving,
  statusMessage,
  similarSuggestion,
  onToggleCategoryPicker,
  onSaveCategory,
  onApplySimilar,
  onDismissSimilar,
  onCreateCategory,
  onSaveRefundMetadata,
  onSaveSemantics,
}: {
  transaction: TransactionWithRelations
  linkCandidates: RefundLinkCandidate[]
  categories: Category[]
  categoriesLoading: boolean
  isEditing: boolean
  isSaving: boolean
  statusMessage: string | null
  similarSuggestion: SimilarCategorySuggestion | null
  onToggleCategoryPicker: (transactionId: string) => void
  onSaveCategory: (
    transactionId: string,
    categoryId: string,
    applyMode?: 'single' | 'similar'
  ) => void
  onApplySimilar: (
    transactionId: string,
    categoryId: string,
    applyMode: 'similar'
  ) => void
  onDismissSimilar: () => void
  onCreateCategory: (
    transactionId: string,
    name: string,
    icon: string,
    color: string
  ) => void
  onSaveRefundMetadata: (
    transactionId: string,
    payload: {
      transaction_kind?: Transaction['transaction_kind']
      linked_transaction_id?: string | null
      budget_effective_date?: string | null
    }
  ) => void
  onSaveSemantics: (
    transactionId: string,
    payload: {
      transaction_kind?: Transaction['transaction_kind']
      budget_behavior?: Transaction['budget_behavior']
      transfer_match_status?: Transaction['transfer_match_status']
      existing_debt_payment?: boolean
    }
  ) => void
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
  const [selectedLinkId, setSelectedLinkId] = useState(tx.linked_transaction_id || '')
  const [budgetEffectiveDate, setBudgetEffectiveDate] = useState(
    tx.budget_effective_date || tx.date
  )

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
  if (tx.transaction_kind === 'refund') {
    metaParts.push('Refund')
  } else if (tx.transaction_kind === 'reimbursement') {
    metaParts.push('Reimbursement')
  } else if (tx.transaction_kind === 'transfer') {
    metaParts.push('Transfer')
  }
  if (tx.budget_behavior === 'count_as_spending') {
    metaParts.push('Counts as spending')
  } else if (tx.budget_behavior === 'count_as_income') {
    metaParts.push('Counts as income')
  } else if (tx.budget_behavior === 'exclude_as_transfer') {
    metaParts.push('Excluded transfer')
  } else if (tx.budget_behavior === 'exclude_manual') {
    metaParts.push('Excluded')
  }
  if (tx.transfer_match_status === 'auto_matched') {
    metaParts.push('Matched')
  } else if (tx.transfer_match_status === 'manually_matched') {
    metaParts.push('Matched')
  } else if (tx.transfer_match_status === 'suggested') {
    metaParts.push('Suggested')
  } else if (tx.transfer_match_status === 'unmatched') {
    metaParts.push('Unmatched')
  } else if (tx.transfer_match_status === 'ignored') {
    metaParts.push('Not transfer')
  }
  const budgetApplication = formatBudgetApplication(tx)
  if (budgetApplication) {
    metaParts.push(budgetApplication)
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
          onClick={() => onToggleCategoryPicker(tx.id)}
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
            {isSaving && <span>Saving...</span>}
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
                    disabled={isSaving}
                    onClick={() => onSaveCategory(tx.id, category.id)}
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
          <div className="refund-tools">
            <div className="tx-category-popover-header">
              <span>Refund handling</span>
              {isSaving && <span>Saving...</span>}
            </div>
            <div className="refund-kind-actions">
              <button
                type="button"
                className={`btn btn-sm ${tx.transaction_kind === 'refund' ? 'btn-primary' : 'btn-ghost'}`}
                disabled={isSaving}
                onClick={() => onSaveRefundMetadata(tx.id, { transaction_kind: 'refund' })}
              >
                Refund
              </button>
              <button
                type="button"
                className={`btn btn-sm ${tx.transaction_kind === 'reimbursement' ? 'btn-primary' : 'btn-ghost'}`}
                disabled={isSaving}
                onClick={() => onSaveRefundMetadata(tx.id, { transaction_kind: 'reimbursement' })}
              >
                Reimbursement
              </button>
              <button
                type="button"
                className={`btn btn-sm ${!tx.transaction_kind || tx.transaction_kind === 'normal' ? 'btn-primary' : 'btn-ghost'}`}
                disabled={isSaving}
                onClick={() => onSaveRefundMetadata(tx.id, { transaction_kind: 'normal' })}
              >
                Normal
              </button>
            </div>
            {tx.linked_transaction_id && (
              <p className="refund-hint">
                Applied to original purchase budget month
                {tx.refund_match_confidence != null &&
                  tx.refund_match_confidence < 0.8 &&
                  tx.refund_match_reason &&
                  ` · Possible refund match: ${tx.refund_match_reason}`}
              </p>
            )}
            <div className="refund-link-row">
              <select
                className="input"
                value={selectedLinkId}
                disabled={isSaving}
                onChange={(e) => setSelectedLinkId(e.target.value)}
              >
                <option value="">No linked purchase</option>
                {linkCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!selectedLinkId || isSaving}
                onClick={() =>
                  onSaveRefundMetadata(tx.id, { linked_transaction_id: selectedLinkId })
                }
              >
                Link
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!tx.linked_transaction_id || isSaving}
                onClick={() => {
                  setSelectedLinkId('')
                  setBudgetEffectiveDate(tx.date)
                  onSaveRefundMetadata(tx.id, { linked_transaction_id: null })
                }}
              >
                Clear
              </button>
            </div>
            <div className="refund-link-row">
              <input
                type="date"
                className="input"
                value={budgetEffectiveDate}
                disabled={isSaving}
                onChange={(e) => setBudgetEffectiveDate(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!budgetEffectiveDate || isSaving}
                onClick={() =>
                  onSaveRefundMetadata(tx.id, {
                    budget_effective_date: budgetEffectiveDate,
                  })
                }
              >
                Apply Date
              </button>
            </div>
          </div>
          <div className="refund-tools">
            <div className="tx-category-popover-header">
              <span>Budget treatment</span>
              {isSaving && <span>Saving...</span>}
            </div>
            <div className="refund-kind-actions">
              <button
                type="button"
                className={`btn btn-sm ${tx.budget_behavior === 'count_as_spending' ? 'btn-primary' : 'btn-ghost'}`}
                disabled={isSaving}
                onClick={() =>
                  onSaveSemantics(tx.id, {
                    transaction_kind:
                      tx.transaction_kind === 'transfer' ? 'transfer' : 'normal',
                    budget_behavior: 'count_as_spending',
                  })
                }
              >
                Count spending
              </button>
              <button
                type="button"
                className={`btn btn-sm ${tx.budget_behavior === 'count_as_income' ? 'btn-primary' : 'btn-ghost'}`}
                disabled={isSaving}
                onClick={() =>
                  onSaveSemantics(tx.id, {
                    transaction_kind: 'normal',
                    budget_behavior: 'count_as_income',
                  })
                }
              >
                Count income
              </button>
              <button
                type="button"
                className={`btn btn-sm ${tx.budget_behavior === 'exclude_as_transfer' ? 'btn-primary' : 'btn-ghost'}`}
                disabled={isSaving}
                onClick={() =>
                  onSaveSemantics(tx.id, {
                    transaction_kind: 'transfer',
                    budget_behavior: 'exclude_as_transfer',
                  })
                }
              >
                Transfer
              </button>
              <button
                type="button"
                className={`btn btn-sm ${tx.budget_behavior === 'exclude_manual' ? 'btn-primary' : 'btn-ghost'}`}
                disabled={isSaving}
                onClick={() =>
                  onSaveSemantics(tx.id, {
                    budget_behavior: 'exclude_manual',
                  })
                }
              >
                Exclude
              </button>
            </div>
            <div className="refund-kind-actions">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={isSaving}
                onClick={() =>
                  onSaveSemantics(tx.id, {
                    existing_debt_payment: true,
                  })
                }
              >
                Existing debt
              </button>
              {tx.transfer_match_status && tx.transfer_match_status !== 'ignored' && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={isSaving}
                  onClick={() =>
                  onSaveSemantics(tx.id, {
                    transaction_kind: 'normal',
                    transfer_match_status: 'ignored',
                      budget_behavior: 'count_as_spending',
                    })
                  }
                >
                  Not transfer
                </button>
              )}
              {tx.transfer_match_status === 'suggested' && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={isSaving}
                  onClick={() =>
                  onSaveSemantics(tx.id, {
                    transfer_match_status: 'manually_matched',
                    })
                  }
                >
                  Confirm match
                </button>
              )}
            </div>
            {tx.transfer_match_reason && (
              <p className="refund-hint">{tx.transfer_match_reason}</p>
            )}
          </div>
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
                      onCreateCategory(tx.id, newCategoryName.trim(), selectedNewIcon, selectedNewColor)
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
                    disabled={!newCategoryName.trim() || isSaving}
                    onClick={() => {
                      onCreateCategory(tx.id, newCategoryName.trim(), selectedNewIcon, selectedNewColor)
                      setNewCategoryName('')
                      setShowNewCategoryForm(false)
                    }}
                  >
                    {isSaving ? 'Creating...' : 'Create'}
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
                disabled={isSaving}
                onClick={() =>
                  onApplySimilar(
                    similarSuggestion.transactionId,
                    similarSuggestion.categoryId,
                    'similar'
                  )
                }
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
})
