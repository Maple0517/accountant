'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatCurrency } from '@/lib/currency'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import {
  AI_PENDING_TAG,
  PLAID_FALLBACK_TAG,
  stripAutomaticClassificationTags,
} from '@/lib/plaid/classification'
import type { AiClassificationJob, Category, Transaction } from '@/types'
import { useI18n } from '@/i18n/client'

type TransactionFilter = {
  search: string
  sourceOrAccount: string
  category: string
  currency: string
  dateFrom: string
  dateTo: string
}

type TransactionGroupBy = 'date' | 'category'
type SavedView = 'all' | 'needs_review' | 'uncategorized' | 'ai_pending' | 'refunds' | 'transfers' | 'pending' | 'large'

const SAVED_VIEWS: Array<{ id: SavedView; labelKey: string }> = [
  { id: 'all', labelKey: 'transactions.all' },
  { id: 'needs_review', labelKey: 'transactions.needsReview' },
  { id: 'uncategorized', labelKey: 'common.uncategorized' },
  { id: 'ai_pending', labelKey: 'transactions.aiPending' },
  { id: 'refunds', labelKey: 'transactions.refunds' },
  { id: 'transfers', labelKey: 'transactions.transfers' },
  { id: 'pending', labelKey: 'common.pending' },
  { id: 'large', labelKey: 'transactions.large' },
]


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

type RefundFormDraft = {
  txId: string
  serverSelectedLinkId: string
  serverBudgetEffectiveDate: string
  selectedLinkId: string
  budgetEffectiveDate: string
}

const EMPTY_LINK_CANDIDATES: RefundLinkCandidate[] = []

function getRefundDraftFromTransaction(tx: TransactionWithRelations): RefundFormDraft {
  const serverSelectedLinkId = tx.linked_transaction_id || ''
  const serverBudgetEffectiveDate = tx.budget_effective_date || tx.date
  return {
    txId: tx.id,
    serverSelectedLinkId,
    serverBudgetEffectiveDate,
    selectedLinkId: serverSelectedLinkId,
    budgetEffectiveDate: serverBudgetEffectiveDate,
  }
}

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

function formatAccountSourceLabel(account: TransactionAccountRelation, manualLabel = 'Manual', accountFallback = 'Account') {
  const institutionName = account.plaid_items?.institution_name
  const accountName =
    account.official_name ||
    account.name ||
    account.subtype ||
    account.type ||
    accountFallback
  const mask = account.mask ? ` ••••${account.mask}` : ''

  if (account.is_manual) {
    return `${manualLabel} · ${accountName}${mask}`
  }

  if (institutionName) {
    return `${institutionName} · ${accountName}${mask}`
  }

  return `${accountName}${mask}`
}

function formatShortDate(dateStr: string, locale = 'en-US') {
  const date = new Date(`${dateStr}T00:00:00`)
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  })
}

function formatBudgetApplication(tx: TransactionWithRelations, t: (key: string, params?: Record<string, string | number>) => string, locale: string) {
  if (!tx.budget_effective_date || tx.budget_effective_date === tx.date) {
    return null
  }

  return t('transactions.budgetApplication', { posted: formatShortDate(tx.date, locale), applied: formatShortDate(tx.budget_effective_date, locale) })
}

const CATEGORY_ICONS = ['🍔', '🚗', '🛍️', '🎬', '💡', '🏥', '📚', '✈️', '💰', '🏠', '💻', '🎮']
const CATEGORY_COLORS = ['#ff9800', '#2196f3', '#e91e63', '#9c27b0', '#4caf50', '#00bcd4', '#f44336', '#607d8b']
const TRANSACTIONS_PAGE_SIZE = 50

function emptyViewCounts(): Record<SavedView, number> {
  return Object.fromEntries(SAVED_VIEWS.map((view) => [view.id, 0])) as Record<SavedView, number>
}

type TransactionsApiResponse = {
  transactions: TransactionWithRelations[]
  totalCount: number
  viewCounts?: Record<SavedView, number>
  categories: Category[]
  accounts: TransactionAccountRelation[]
  limit: number
  offset: number
  error?: string
}

export default function TransactionsPage() {
  const { categoryName, locale, t } = useI18n()
  const localeCode = locale === 'zh' ? 'zh-CN' : 'en-US'
  const [transactions, setTransactions] = useState<TransactionWithRelations[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [serverViewCounts, setServerViewCounts] = useState<Record<SavedView, number>>(emptyViewCounts)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshingAi, setRefreshingAi] = useState(false)
  const [aiRefreshStatus, setAiRefreshStatus] = useState<string | null>(null)
  const [aiJob, setAiJob] = useState<AiClassificationJob | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [accountOptions, setAccountOptions] = useState<AccountFilterOption[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [groupBy, setGroupBy] = useState<TransactionGroupBy>('date')
  const [savedView, setSavedView] = useState<SavedView>('all')
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

  const transactionsRequestIdRef = useRef(0)

  const fetchTransactions = useCallback(
    async (options: { append?: boolean; offset?: number } = {}) => {
      const append = options.append ?? false
      const offset = options.offset ?? 0
      const requestId = transactionsRequestIdRef.current + 1
      transactionsRequestIdRef.current = requestId

      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }

      const params = new URLSearchParams({
        limit: String(TRANSACTIONS_PAGE_SIZE),
        offset: String(offset),
        sourceOrAccount: queryFilters.sourceOrAccount,
        category: queryFilters.category,
        currency: queryFilters.currency,
        savedView,
      })

      if (queryFilters.search) params.set('search', queryFilters.search)
      if (queryFilters.dateFrom) params.set('dateFrom', queryFilters.dateFrom)
      if (queryFilters.dateTo) params.set('dateTo', queryFilters.dateTo)

      try {
        const response = await fetch(`/api/transactions?${params.toString()}`)
        const payload = (await response.json()) as TransactionsApiResponse

        if (transactionsRequestIdRef.current !== requestId) return

        if (!response.ok) {
          console.error('Error fetching transactions:', payload.error)
          return
        }

        const nextTransactions = payload.transactions || []
        setTransactions((current) =>
          append ? [...current, ...nextTransactions] : nextTransactions
        )
        setTotalCount(payload.totalCount || 0)
        setServerViewCounts((current) => ({
          ...current,
          ...(payload.viewCounts || {}),
        }))
        setCategories(payload.categories || [])
        setCategoriesLoading(false)
        setAccountOptions(
          (payload.accounts || [])
            .map((account) => ({
              id: account.id || '',
              label: formatAccountSourceLabel(account, t('common.manual')),
              institutionName: account.plaid_items?.institution_name ?? null,
              accountName: account.name ?? account.official_name ?? null,
              mask: account.mask ?? null,
              type: account.type ?? null,
            }))
            .filter((account) => account.id)
        )
        if (!append) {
          setEditingTransactionId((current) =>
            current && nextTransactions.some((tx) => tx.id === current)
              ? current
              : null
          )
        }
      } catch (error) {
        if (transactionsRequestIdRef.current === requestId) {
          console.error('Error fetching transactions:', error)
        }
      } finally {
        if (transactionsRequestIdRef.current === requestId) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [queryFilters, savedView, t]
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      fetchTransactions()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [fetchTransactions])

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
              setAiRefreshStatus(t('transactions.retrying', { error: data.error }))
              await delay(10000)
              continue
            }

            throw new Error(data.error || t('transactions.processAiQueueError'))
          }

          const nextJob = data.job as AiClassificationJob | null
          if (nextJob) {
            setAiJob(nextJob)
            setAiRefreshStatus(
              t('transactions.aiQueue', { done: nextJob.completed_count, total: nextJob.total_count, pending: nextJob.pending_count, failed: nextJob.failed_count })
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
          error instanceof Error ? error.message : t('transactions.processAiQueueError')
        )
      } finally {
        setRefreshingAi(false)
      }
    },
    [fetchTransactions, t]
  )

  const fetchLatestAiJob = useCallback(async () => {
    try {
      const response = await fetch('/api/plaid/ai-classification-jobs')
      const data = await response.json()

      if (data.queue_unavailable) {
        setAiJob(null)
        setAiRefreshStatus(data.error || t('transactions.aiQueueUnavailable'))
        return
      }

      if (!response.ok) {
        setAiRefreshStatus(data.error || t('transactions.loadAiQueueError'))
        return
      }

      const job = data.job as AiClassificationJob | null
      setAiJob(job)

      if (isActiveAiJob(job)) {
        setAiRefreshStatus(
          t('transactions.aiQueue', { done: job.completed_count, total: job.total_count, pending: job.pending_count, failed: job.failed_count })
        )
        processAiQueue(job.id)
      }
    } catch (error) {
      console.warn('Failed to load AI queue:', error)
      setAiRefreshStatus(
        error instanceof Error ? error.message : t('transactions.loadAiQueueError')
      )
    }
  }, [processAiQueue, t])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      fetchLatestAiJob()
    }, 800)

    return () => window.clearTimeout(timeoutId)
  }, [fetchLatestAiJob])

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
        const displayCategoryName = categoryName(
          updatedCategory || categories.find((category) => category.id === categoryId),
          t('transactions.selectedCategory')
        )

        setEditingTransactionId(null)

        if (applyMode === 'similar') {
          setCategorySaveStatus({
            transactionId,
            message: t('transactions.categoryUpdatedSimilar', { category: displayCategoryName, count: data.updated_count || 0 }),
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
              categoryName: displayCategoryName,
              similarCount: data.similar_count,
            })
            setCategorySaveStatus({
              transactionId,
              message: t('transactions.categoryUpdated', { category: displayCategoryName }),
            })
          } else {
            setSimilarSuggestion(null)
            setCategorySaveStatus({
              transactionId,
              message: t('transactions.categoryUpdated', { category: displayCategoryName }),
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
    [categories, categoryName, fetchTransactions, t]
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
          message: error instanceof Error ? error.message : t('transactions.createCategoryError'),
        })
      } finally {
        setSavingTransactionId(null)
      }
    },
    [handleCategorySave, t]
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
          message: t('transactions.refundSettingsSaved'),
        })
      } catch (error) {
        console.error('Failed to update refund metadata:', error)
        setCategorySaveStatus({
          transactionId,
          message:
            error instanceof Error ? error.message : t('transactions.refundMetadataError'),
        })
      } finally {
        setSavingTransactionId(null)
      }
    },
    [t]
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
          message: t('transactions.treatmentSaved'),
        })
      } catch (error) {
        console.error('Failed to update transaction treatment:', error)
        setCategorySaveStatus({
          transactionId,
          message:
            error instanceof Error ? error.message : t('transactions.treatmentError'),
        })
      } finally {
        setSavingTransactionId(null)
      }
    },
    [t]
  )

  const visibleTransactions = transactions

  const visibleTransactionsGroupedByDate = useMemo(
    () =>
      visibleTransactions.reduce(
        (groups, tx) => {
          const date = tx.date
          if (!groups[date]) groups[date] = []
          groups[date].push(tx)
          return groups
        },
        {} as Record<string, TransactionWithRelations[]>
      ),
    [visibleTransactions]
  )

  const visibleTransactionsGroupedByCategory = useMemo(() => {
    const categorySortMap = new Map(
      categories.map((category) => [category.id, category.sort_order ?? 0])
    )
    const groupMap = new Map<string, CategoryTransactionGroup>()

    for (const tx of visibleTransactions) {
      const categoryId = tx.category_id ?? null
      const key = categoryId || 'uncategorized'
      const category = tx.categories

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          categoryId,
          categoryName: categoryName(category),
          categoryIcon: category?.icon || '•',
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
  }, [visibleTransactions, categories, categoryName])

  const pendingCount = serverViewCounts.pending || 0
  const needsReviewCount = serverViewCounts.needs_review || 0
  const totalVisibleAmount = visibleTransactions.reduce((sum, tx) => sum + Number(tx.amount), 0)
  const visibleCurrency = visibleTransactions.find((tx) => tx.iso_currency_code)?.iso_currency_code || 'USD'
  const hasTransactions = visibleTransactions.length > 0
  const hasMoreTransactions = transactions.length < totalCount

  const handleLoadMore = useCallback(() => {
    fetchTransactions({
      append: true,
      offset: transactions.length,
    })
  }, [fetchTransactions, transactions.length])

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

    if (dateStr === today.toISOString().split('T')[0]) return t('common.today')
    if (dateStr === yesterday.toISOString().split('T')[0]) return t('common.yesterday')

    return date.toLocaleDateString(localeCode, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }, [localeCode, t])

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
        categoryName={categoryName}
        localeCode={localeCode}
        t={t}
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
      categoryName,
      localeCode,
      linkCandidatesByTransactionId,
      t,
      savingTransactionId,
      similarSuggestion,
    ]
  )

  return (
    <div className="transactions-page">
      <PageHeader
        title={t('transactions.title')}
        subtitle={t('transactions.subtitle', { visible: visibleTransactions.length, loaded: transactions.length, totalPart: totalCount > transactions.length ? t('transactions.loadedTotalPart', { loaded: transactions.length, total: totalCount }) : '' })}
      />

      <div className="transactions-summary-grid">
        <div className="card card-pad-sm"><span className="metric-label">{t('transactions.loaded')}</span><span className="metric-value">{transactions.length}</span></div>
        <div className="card card-pad-sm"><span className="metric-label">{t('transactions.needsReview')}</span><span className="metric-value">{needsReviewCount}</span></div>
        <div className="card card-pad-sm"><span className="metric-label">{t('common.pending')}</span><span className="metric-value">{pendingCount}</span></div>
        <div className="card card-pad-sm"><span className="metric-label">{t('transactions.visibleNet')}</span><span className="metric-value">{formatCurrency(-totalVisibleAmount, visibleCurrency)}</span></div>
      </div>

      {(aiRefreshStatus || aiJob) && (
        <div className="ai-refresh-status">
          <span>{aiRefreshStatus}</span>
          {aiJob && (
            <span>
              {t('transactions.total')} {aiJob.total_count} · {t('common.pending')} {aiJob.pending_count} · {t('transactions.done')} {aiJob.completed_count} · Failed {aiJob.failed_count}
            </span>
          )}
        </div>
      )}

      <div className="saved-view-row" aria-label={t('transactions.savedViewsAria')}>
        {SAVED_VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            className={`btn btn-sm ${savedView === view.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setSavedView(view.id)}
          >
            {t(view.labelKey)}
            <span className="badge badge-muted">{serverViewCounts[view.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="card filters-bar">
        <div className="filter-group">
          <input
            type="text"
            className="input"
            aria-label={t('transactions.searchAria')}
            placeholder={t('transactions.searchPlaceholder')}
            value={filters.search}
            onChange={(e) =>
              setFilters((f) => ({ ...f, search: e.target.value }))
            }
          />
        </div>
        <div className="filter-row">
          <select
            className="input"
            aria-label={t('transactions.accountFilterAria')}
            value={filters.sourceOrAccount}
            onChange={(e) =>
              setFilters((f) => ({ ...f, sourceOrAccount: e.target.value }))
            }
          >
            <option value="all">{t('transactions.allAccounts')}</option>
            {accountOptions.map((account) => (
              <option key={account.id} value={`account:${account.id}`}>
                {account.label}
              </option>
            ))}
            <option value="manual">{t('common.manual')}</option>
            <option value="receipt">{t('common.receipt')}</option>
          </select>
          <select
            className="input"
            aria-label={t('transactions.categoryFilterAria')}
            value={filters.category}
            onChange={(e) =>
              setFilters((f) => ({ ...f, category: e.target.value }))
            }
          >
            <option value="all">{t('transactions.allCategories')}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.icon || '•'} {categoryName(category)}
              </option>
            ))}
            <option value="uncategorized">{t('common.uncategorized')}</option>
          </select>
          <select
            className="input"
            aria-label={t('transactions.currencyFilterAria')}
            value={filters.currency}
            onChange={(e) =>
              setFilters((f) => ({ ...f, currency: e.target.value }))
            }
          >
            <option value="all">{t('transactions.allCurrencies')}</option>
            <option value="USD">USD</option>
            <option value="CNY">CNY</option>
          </select>
          <input
            type="date"
            className="input"
            aria-label={t('transactions.fromDateAria')}
            value={filters.dateFrom}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dateFrom: e.target.value }))
            }
          />
          <input
            type="date"
            className="input"
            aria-label={t('transactions.toDateAria')}
            value={filters.dateTo}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dateTo: e.target.value }))
            }
          />
        </div>
        <div className="view-toggle-row">
          <span className="text-secondary">{t('transactions.groupBy')}</span>
          <div className="segmented-control" aria-label={t('transactions.groupByAria')}>
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
          <h3>{t('transactions.emptyTitle')}</h3>
          <p className="text-secondary">
            {t('transactions.emptyCopy')}
          </p>
        </div>
      ) : (
        <div className="transaction-groups">
          {groupBy === 'date'
            ? Object.entries(visibleTransactionsGroupedByDate).map(([date, txs]) => {
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
            : visibleTransactionsGroupedByCategory.map((group) => (
                <div key={group.key} className="transaction-group">
                  <div className="group-header">
                    <span className="group-date">
                      <span
                        className="group-category-icon"
                        style={group.categoryColor ? { color: group.categoryColor } : undefined}
                      >
                        {group.categoryIcon}
                      </span>{' '}
                      {group.categoryName}
                      <span className="group-count"> · {t('transactions.transactionCount', { count: group.transactions.length, plural: group.transactions.length === 1 ? '' : 's' })}</span>
                    </span>
                    <span className={`group-total ${group.total <= 0 ? 'income' : 'expense'}`}>
                      {formatCurrency(-group.total, group.transactions[0]?.iso_currency_code || 'USD')}
                    </span>
                  </div>
                  <div className="card transaction-list-card">
                    {group.transactions.map(renderTransactionItem)}
                  </div>
                </div>
              ))}
          {hasMoreTransactions && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? t('common.loading') : t('transactions.loadMore')}
              </button>
            </div>
          )}
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
  categoryName,
  localeCode,
  t,
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
  categoryName: (category?: { name?: string | null; name_zh?: string | null } | null, fallback?: string) => string
  localeCode: string
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const amount = Number(tx.amount)
  const isIncome = amount < 0
  const displayAmount = -amount
  const categoryIcon = tx.categories?.icon || '📦'
  const displayCategoryName = categoryName(tx.categories)
  const merchantName = tx.merchant_name || tx.description
  const accountLabel = tx.accounts ? formatAccountSourceLabel(tx.accounts, t('common.manual')) : null
  const tags = Array.isArray(tx.tags) ? tx.tags : []
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [selectedNewIcon, setSelectedNewIcon] = useState(CATEGORY_ICONS[0])
  const [selectedNewColor, setSelectedNewColor] = useState(CATEGORY_COLORS[5])
  const [refundFormDraft, setRefundFormDraft] = useState<RefundFormDraft>(() =>
    getRefundDraftFromTransaction(tx)
  )
  const syncedRefundFormDraft =
    refundFormDraft.txId === tx.id &&
    refundFormDraft.serverSelectedLinkId === (tx.linked_transaction_id || '') &&
    refundFormDraft.serverBudgetEffectiveDate === (tx.budget_effective_date || tx.date)
      ? refundFormDraft
      : getRefundDraftFromTransaction(tx)

  const selectedLinkId = syncedRefundFormDraft.selectedLinkId
  const budgetEffectiveDate = syncedRefundFormDraft.budgetEffectiveDate
  const setSelectedLinkId = (selectedLinkId: string) =>
    setRefundFormDraft({ ...syncedRefundFormDraft, selectedLinkId })
  const setBudgetEffectiveDate = (budgetEffectiveDate: string) =>
    setRefundFormDraft({ ...syncedRefundFormDraft, budgetEffectiveDate })

  let classificationStatus: string | null = null
  if (tags.includes(AI_PENDING_TAG) || tags.includes(PLAID_FALLBACK_TAG)) {
    classificationStatus = t('transactions.aiPending')
  }

  const badgeParts: Array<{ label: string; tone: 'accent' | 'success' | 'warning' | 'info' | 'muted' }> = []
  if (classificationStatus) {
    badgeParts.push({ label: classificationStatus, tone: classificationStatus === 'AI Pending' ? 'accent' : 'success' })
  }
  if (tx.pending) badgeParts.push({ label: t('common.pending'), tone: 'warning' })
  if (tx.transaction_kind === 'refund') badgeParts.push({ label: t('common.refund'), tone: 'success' })
  if (tx.transaction_kind === 'reimbursement') badgeParts.push({ label: t('common.reimbursement'), tone: 'success' })
  if (tx.transaction_kind === 'transfer') badgeParts.push({ label: t('common.transfer'), tone: 'info' })
  if (tx.budget_behavior === 'count_as_income') badgeParts.push({ label: t('transactions.countsIncome'), tone: 'success' })
  if (tx.budget_behavior === 'exclude_as_transfer') badgeParts.push({ label: t('transactions.excludedTransfer'), tone: 'muted' })
  if (tx.budget_behavior === 'exclude_manual') badgeParts.push({ label: t('common.excluded'), tone: 'muted' })
  if (tx.transfer_match_status === 'auto_matched' || tx.transfer_match_status === 'manually_matched') badgeParts.push({ label: t('common.matched'), tone: 'success' })
  if (tx.transfer_match_status === 'suggested') badgeParts.push({ label: t('common.suggested'), tone: 'warning' })
  if (tx.transfer_match_status === 'unmatched') badgeParts.push({ label: t('common.unmatched'), tone: 'warning' })

  const badgeLabels = new Set(badgeParts.map((badge) => badge.label))
  const metaParts: string[] = []
  const pushMetaPart = (label: string, dedupeAgainst?: string[]) => {
    const labelsToCheck = [label, ...(dedupeAgainst || [])]
    if (labelsToCheck.some((candidate) => badgeLabels.has(candidate))) {
      return
    }
    metaParts.push(label)
  }

  if (accountLabel) {
    metaParts.push(accountLabel)
  }

  if (classificationStatus) {
    pushMetaPart(classificationStatus)
  }

  if (tx.source === 'receipt') {
    metaParts.push('Receipt')
  } else if (tx.source === 'manual' && !accountLabel) {
    metaParts.push('Manual')
  }
  if (tx.budget_behavior === 'count_as_income') {
    pushMetaPart(t('transactions.countsAsIncome'), [t('transactions.countsIncome')])
  }
  if (tx.transfer_match_status === 'auto_matched') {
    pushMetaPart(t('common.matched'))
  } else if (tx.transfer_match_status === 'manually_matched') {
    pushMetaPart(t('common.matched'))
  } else if (tx.transfer_match_status === 'suggested') {
    pushMetaPart(t('common.suggested'))
  } else if (tx.transfer_match_status === 'unmatched') {
    pushMetaPart(t('common.unmatched'))
  } else if (tx.transfer_match_status === 'ignored') {
    pushMetaPart(t('common.notTransfer'))
  }
  const metaText = metaParts.join(' · ')

  return (
    <div className="transaction-item">
      <div className="tx-row-main">
        <div className="tx-icon">{categoryIcon}</div>
        <div className="tx-details">
          <span className="tx-merchant">{merchantName}</span>
          {metaText && <span className="tx-meta">{metaText}</span>}
          {badgeParts.length > 0 && (
            <span className="tx-badges">
              {badgeParts.slice(0, 5).map((badge) => (
                <Badge key={badge.label} tone={badge.tone}>{badge.label}</Badge>
              ))}
            </span>
          )}
        </div>
        <button
          type="button"
          className="tx-category-pill"
          style={getCategoryButtonStyle(
            (tx.categories || {
              id: tx.category_id || 'uncategorized',
              name: t('common.uncategorized'),
              user_id: '',
              type: 'expense',
              sort_order: 0,
              created_at: '',
            }) as Category,
            true
          )}
          aria-expanded={isEditing}
          aria-label={t('transactions.changeCategoryAria', { merchant: merchantName })}
          onClick={() => onToggleCategoryPicker(tx.id)}
        >
          <span className="tx-category-pill-icon">{categoryIcon}</span>
          <span className="tx-category-pill-label">{displayCategoryName}</span>
        </button>
        <div className={`tx-amount ${isIncome ? 'income' : 'expense'}`}>
          {formatCurrency(displayAmount, tx.iso_currency_code || 'USD')}
        </div>
      </div>
      {isEditing && (
        <div className="tx-category-popover">
          <div className="tx-category-popover-header">
            <span>{t('transactions.pickCategory')}</span>
            {isSaving && <span>{t('common.saving')}</span>}
          </div>
          {categoriesLoading ? (
            <p className="text-secondary">{t('transactions.loadingCategories')}</p>
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
                      {categoryName(category)}
                    </span>
                    {category.is_excluded_from_budget && (
                      <span className="category-chip-badge">{t('transactions.excludedFromBudget')}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          <div className="refund-tools">
            <div className="tx-category-popover-header">
              <span>{t('transactions.refundHandling')}</span>
              {isSaving && <span>{t('common.saving')}</span>}
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
                {t('transactions.appliedOriginalBudget')}
                {tx.refund_match_confidence != null &&
                  tx.refund_match_confidence < 0.8 &&
                  tx.refund_match_reason &&
                  ` · ${t('transactions.possibleRefundMatch', { reason: tx.refund_match_reason })}`}
              </p>
            )}
            <div className="refund-link-row">
              <select
                className="input"
                aria-label={t('transactions.linkedPurchaseAria', { merchant: merchantName })}
                value={selectedLinkId}
                disabled={isSaving}
                onChange={(e) => setSelectedLinkId(e.target.value)}
              >
                <option value="">{t('transactions.noLinkedPurchase')}</option>
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
                  setRefundFormDraft({
                    ...syncedRefundFormDraft,
                    selectedLinkId: '',
                    budgetEffectiveDate: tx.date,
                  })
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
                aria-label={t('transactions.budgetDateAria', { merchant: merchantName })}
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
              <span>{t('transactions.budgetTreatment')}</span>
              {isSaving && <span>{t('common.saving')}</span>}
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
                {t('transactions.defaultTreatment')}
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
                  placeholder={t('transactions.newCategoryPlaceholder')}
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
                      aria-label={t('transactions.iconAria', { icon })}
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
                      aria-label={t('transactions.colorAria', { color })}
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
                    {isSaving ? t('transactions.creating') : t('common.create')}
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
                {t('transactions.newCategory')}
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
                {t('transactions.similarPrompt', { category: similarSuggestion.categoryName, count: similarSuggestion.similarCount })}
              </span>
            ) : statusMessage && (
              <span className="category-save-status">{statusMessage}</span>
            )}
          </div>
          {similarSuggestion && (
            <div className="similar-suggestion-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={isSaving}
                onClick={() =>
                  onApplySimilar(
                    similarSuggestion.transactionId,
                    similarSuggestion.categoryId,
                    'similar'
                  )
                }
              >
                {t('transactions.syncSimilar')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onDismissSimilar}
              >
                {t('transactions.onlyThis')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
})
