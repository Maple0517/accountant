'use client'

import '@/i18n/namespaces/transactions'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { formatCurrency } from '@/lib/currency'
import { formatCurrencyTotals, hasMultipleCurrencies, sumByCurrency } from '@/lib/money/totals'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Drawer } from '@/components/ui/Drawer'
import {
  AI_PENDING_TAG,
  PLAID_FALLBACK_TAG,
  stripAutomaticClassificationTags,
} from '@/lib/plaid/classification'
import { needsRefundReview, needsTransferReview } from '@/lib/transactions/review'
import { getTransactionBadgeParts, hasTransactionNeedsReviewBadge } from '@/lib/transactions/badges'
import { normalizeCurrencyCode } from '@/lib/money/currency'
import {
  deriveTransactionTreatment,
  normalizeTransactionSemantics,
} from '@/lib/transactions/treatment'
import { buildTransactionsQueryParams } from '@/lib/transactions/query'
import type {
  AiClassificationJob,
  Category,
  Transaction,
} from '@/types'
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

const PRIMARY_SAVED_VIEW_IDS: SavedView[] = ['all', 'needs_review']

const SAVED_VIEW_GROUPS: Array<{
  id: string
  labelKey: string
  views: SavedView[]
}> = [
  {
    id: 'attention',
    labelKey: 'transactions.viewGroupAttention',
    views: ['uncategorized', 'ai_pending', 'pending'],
  },
  {
    id: 'explore',
    labelKey: 'transactions.viewGroupExplore',
    views: ['refunds', 'transfers', 'large'],
  },
]

function getSavedViewFromParams(searchParams: URLSearchParams): SavedView {
  const savedView = searchParams.get('savedView')
  return savedView && SAVED_VIEWS.some((view) => view.id === savedView)
    ? (savedView as SavedView)
    : 'all'
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
  totalsByCurrency: Map<string, number>
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

const SplitEditorDrawer = dynamic(
  () => import('@/components/transactions/SplitEditorDrawer'),
  { ssr: false }
)


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


function getTxTreatment(tx: Pick<Transaction, 'treatment'>) {
  return deriveTransactionTreatment({
    treatment: tx.treatment,
  })
}

function getTxRefundSource(tx: Pick<Transaction, 'treatment' | 'refund_source' | 'amount'>) {
  return normalizeTransactionSemantics({
    treatment: tx.treatment,
    refundSource: tx.refund_source,
    amount: Number(tx.amount),
  }).refundSource
}




function isActiveAiJob(job: AiClassificationJob | null): job is AiClassificationJob {
  return job?.status === 'queued' || job?.status === 'running'
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

function getCategoryButtonStyle(category?: Pick<Category, 'color'> | null) {
  const color = category?.color || '#7f8b99'
  return {
    '--category-pill-accent': color,
    '--category-pill-accent-soft': `${color}14`,
    '--category-pill-accent-border': `${color}2e`,
  } as CSSProperties
}

function formatAccountSourceLabel(
  account: TransactionAccountRelation,
  manualLabel: string,
  accountFallback: string
) {
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

function totalOfCurrencyMap(totals: Map<string, number>) {
  return Array.from(totals.values()).reduce((sum, amount) => sum + amount, 0)
}

function formatGroupSummary(
  txs: TransactionWithRelations[],
  totals: Map<string, number>,
  t: (key: string, params?: Record<string, string | number>) => string
) {
  const count = txs.length
  const noun = t('transactions.transactionCount', {
    count,
    plural: count === 1 ? '' : 's',
  })

  const amountSummaries =
    totals.size === 0
      ? [
          `${formatCurrency(0, 'USD')} ${t('transactions.spentSummaryLabel')}`,
        ]
      : Array.from(totals.entries()).map(([currency, amount]) => {
          const direction =
            amount <= 0
              ? t('transactions.incomeSummaryLabel')
              : t('transactions.spentSummaryLabel')

          return `${formatCurrency(Math.abs(amount), currency)} ${direction}`
        })

  return `${noun} · ${amountSummaries.join(' · ')}`
}

const CATEGORY_ICONS = ['🍔', '🚗', '🛍️', '🎬', '💡', '🏥', '📚', '✈️', '💰', '🏠', '💻', '🎮']
const CATEGORY_COLORS = ['#ff9800', '#2196f3', '#e91e63', '#9c27b0', '#4caf50', '#00bcd4', '#f44336', '#607d8b']
const TRANSACTIONS_PAGE_SIZE = 50

function emptyViewCounts(): Record<SavedView, number> {
  return Object.fromEntries(SAVED_VIEWS.map((view) => [view.id, 0])) as Record<SavedView, number>
}

type TransactionsApiResponse = {
  transactions: TransactionWithRelations[]
  totalCount?: number
  viewCounts?: Record<SavedView, number>
  allAiPendingCount?: number
  categories?: Category[]
  accounts?: TransactionAccountRelation[]
  limit: number
  offset: number
  error?: string
}

type AttentionNotice = {
  key: string
  tone: 'warning' | 'accent' | 'neutral'
  label: string
  message: string
  actionLabel?: string
  actionKey?: 'needs_review' | 'uncategorized' | 'pending' | 'queue_ai'
  busy?: boolean
}

type DetailSectionKey = 'category' | 'semantics' | 'split'

export default function TransactionsPage() {
  const { categoryName, locale, t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialSavedView = getSavedViewFromParams(searchParams)
  const initialCategory = searchParams.get('category') || 'all'
  const initialDateFrom = searchParams.get('dateFrom') || ''
  const initialDateTo = searchParams.get('dateTo') || ''
  const initialTransactionId = searchParams.get('tx') || ''
  const localeCode = locale === 'zh' ? 'zh-CN' : 'en-US'
  const [transactions, setTransactions] = useState<TransactionWithRelations[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [serverViewCounts, setServerViewCounts] = useState<Record<SavedView, number>>(emptyViewCounts)
  const [allAiPendingCount, setAllAiPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [aiRefreshStatus, setAiRefreshStatus] = useState<string | null>(null)
  const [aiJob, setAiJob] = useState<AiClassificationJob | null>(null)
  const [aiQueueActionLoading, setAiQueueActionLoading] = useState(false)
  const [aiQueueProcessing, setAiQueueProcessing] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [accountOptions, setAccountOptions] = useState<AccountFilterOption[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [groupBy, setGroupBy] = useState<TransactionGroupBy>('date')
  const [savedView, setSavedView] = useState<SavedView>(initialSavedView)
  const [focusedTransactionId, setFocusedTransactionId] = useState(initialTransactionId)
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(initialTransactionId || null)
  const [savingTransactionId, setSavingTransactionId] = useState<string | null>(null)
  const [categorySaveStatus, setCategorySaveStatus] = useState<{
    transactionId: string
    message: string
  } | null>(null)
  const [similarSuggestion, setSimilarSuggestion] =
    useState<SimilarCategorySuggestion | null>(null)
  const [splitEditorTransaction, setSplitEditorTransaction] =
    useState<TransactionWithRelations | null>(null)
  const [filters, setFilters] = useState<TransactionFilter>({
    search: '',
    sourceOrAccount: 'all',
    category: initialCategory,
    currency: 'all',
    dateFrom: initialDateFrom,
    dateTo: initialDateTo,
  })

  const debouncedSearch = useDebouncedValue(filters.search, 300)
  const assignableCategories = useMemo(
    () => categories.filter((category) => category.type === 'expense'),
    [categories]
  )
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
  const transactionsAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const querySavedView = getSavedViewFromParams(searchParams)
    const queryCategory = searchParams.get('category') || 'all'
    const queryDateFrom = searchParams.get('dateFrom') || ''
    const queryDateTo = searchParams.get('dateTo') || ''
    const queryTx = searchParams.get('tx')

    const timeoutId = window.setTimeout(() => {
      setSavedView((current) => (current === querySavedView ? current : querySavedView))
      setFilters((current) => (
        current.category === queryCategory &&
        current.dateFrom === queryDateFrom &&
        current.dateTo === queryDateTo
          ? current
          : {
              ...current,
              category: queryCategory,
              dateFrom: queryDateFrom,
              dateTo: queryDateTo,
            }
      ))
      if (queryTx) {
        setFocusedTransactionId(queryTx)
        setEditingTransactionId(queryTx)
        setAdvancedFiltersOpen(false)
      } else {
        setFocusedTransactionId('')
      }
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [searchParams])

  const buildTransactionQueryParams = useCallback(
    (options: { offset?: number; savedViewOverride?: SavedView; includeMetadata?: boolean } = {}) => {
      return buildTransactionsQueryParams({
        limit: TRANSACTIONS_PAGE_SIZE,
        offset: options.offset ?? 0,
        sourceOrAccount: queryFilters.sourceOrAccount,
        category: queryFilters.category,
        currency: queryFilters.currency,
        savedView: options.savedViewOverride ?? savedView,
        search: queryFilters.search,
        dateFrom: queryFilters.dateFrom,
        dateTo: queryFilters.dateTo,
        tx: focusedTransactionId,
        includeViewCounts: (options.offset ?? 0) === 0,
        includeMetadata: options.includeMetadata ?? true,
      })
    },
    [focusedTransactionId, queryFilters, savedView]
  )

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
        setLoadError(null)
      }

      const params = buildTransactionQueryParams({ offset, includeMetadata: !append })
      transactionsAbortControllerRef.current?.abort()
      const controller = new AbortController()
      transactionsAbortControllerRef.current = controller

      try {
        const response = await fetch(`/api/transactions?${params.toString()}`, {
          signal: controller.signal,
        })
        const payload = (await response.json()) as TransactionsApiResponse

        if (transactionsRequestIdRef.current !== requestId) return

        if (!response.ok) {
          const message = payload.error || t('transactions.loadTransactionsError')
          console.error('Error fetching transactions:', message)
          setLoadError(message)
          return
        }

        const nextTransactions = payload.transactions || []
        setTransactions((current) =>
          append ? [...current, ...nextTransactions] : nextTransactions
        )
        if (typeof payload.totalCount === 'number') {
          setTotalCount(payload.totalCount)
        }
        if (payload.viewCounts) {
          setServerViewCounts((current) => ({
            ...current,
            ...payload.viewCounts,
          }))
        }
        if (typeof payload.allAiPendingCount === 'number') {
          setAllAiPendingCount(payload.allAiPendingCount)
        }
        if (Array.isArray(payload.categories)) {
          setCategories(payload.categories)
          setCategoriesLoading(false)
        }
        if (Array.isArray(payload.accounts)) {
          setAccountOptions(
            payload.accounts
              .map((account) => ({
                id: account.id || '',
                label: formatAccountSourceLabel(account, t('common.manual'), t('common.account')),
                institutionName: account.plaid_items?.institution_name ?? null,
                accountName: account.name ?? account.official_name ?? null,
                mask: account.mask ?? null,
                type: account.type ?? null,
              }))
              .filter((account) => account.id)
          )
        }
        if (!append) {
          setEditingTransactionId((current) =>
            current && nextTransactions.some((tx) => tx.id === current)
              ? current
              : null
          )
        }
      } catch (error) {
        if (controller.signal.aborted) return
        if (transactionsRequestIdRef.current === requestId) {
          console.error('Error fetching transactions:', error)
          setLoadError(
            error instanceof Error ? error.message : t('transactions.loadTransactionsError')
          )
        }
      } finally {
        if (transactionsRequestIdRef.current === requestId) {
          if (transactionsAbortControllerRef.current === controller) {
            transactionsAbortControllerRef.current = null
          }
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [buildTransactionQueryParams, t]
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      fetchTransactions()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [fetchTransactions])

  const processAiQueue = useCallback(
    async (jobId: string) => {
      setAiQueueProcessing(true)

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
              const retryJob = data.job as AiClassificationJob | null
              if (retryJob) {
                setAiJob(retryJob)
                setAiRefreshStatus(
                  t('transactions.aiPendingReason', {
                    count: retryJob.pending_count,
                    plural: retryJob.pending_count === 1 ? '' : 's',
                    reason: data.error || t('transactions.processAiQueueError'),
                  })
                )
              } else {
                setAiRefreshStatus(t('transactions.retrying', { error: data.error }))
              }
              keepProcessing = false
              break
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
        setAiQueueProcessing(false)
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
          job.error_message
            ? t('transactions.aiPendingReason', {
                count: job.pending_count,
                plural: job.pending_count === 1 ? '' : 's',
                reason: job.error_message,
              })
            : t('transactions.aiQueue', { done: job.completed_count, total: job.total_count, pending: job.pending_count, failed: job.failed_count })
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

  const handleQueueAiRefresh = useCallback(async () => {
    setAiQueueActionLoading(true)
    setAiRefreshStatus(t('transactions.processingAi'))

    try {
      if (isActiveAiJob(aiJob)) {
        await processAiQueue(aiJob.id)
        await fetchTransactions()
        return
      }

      const response = await fetch('/api/plaid/ai-classification-jobs', {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || t('transactions.createAiQueueError'))
      }

      const job = data.job as AiClassificationJob | null
      setAiJob(job)

      if (!job || job.total_count === 0) {
        setAiRefreshStatus(t('transactions.noPendingAi'))
        await fetchTransactions()
        return
      }

      setAiRefreshStatus(
        t('transactions.aiQueueStarted', {
          count: job.total_count,
          plural: job.total_count === 1 ? '' : 's',
        })
      )
      await processAiQueue(job.id)
      await fetchTransactions()
    } catch (error) {
      console.error('Failed to create AI queue:', error)
      setAiRefreshStatus(
        error instanceof Error ? error.message : t('transactions.createAiQueueError')
      )
    } finally {
      setAiQueueActionLoading(false)
    }
  }, [aiJob, fetchTransactions, processAiQueue, t])

  const closeDetailDrawerForTransaction = useCallback(
    (transactionId: string) => {
      if (editingTransactionId !== transactionId) return

      setEditingTransactionId(null)
      setSimilarSuggestion(null)

      if (!focusedTransactionId) return

      setFocusedTransactionId('')
      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.delete('tx')
      const query = nextParams.toString()
      router.replace(query ? `/transactions?${query}` : '/transactions', {
        scroll: false,
      })
    },
    [editingTransactionId, focusedTransactionId, router, searchParams]
  )

  const handleCategorySave = useCallback(
    async (
      transactionId: string,
      categoryId: string,
      applyMode: 'single' | 'similar' = 'single',
      options: { closeOnSuccess?: boolean } = {}
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

        const updatedTransaction = data.transaction as Partial<TransactionWithRelations> | undefined
        const updatedCategory = updatedTransaction?.categories as
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
                    ...updatedTransaction,
                    category_id: categoryId,
                    tags:
                      updatedTransaction?.tags ??
                      stripAutomaticClassificationTags(tx.tags),
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

        if (options.closeOnSuccess) {
          closeDetailDrawerForTransaction(transactionId)
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
    [categories, categoryName, closeDetailDrawerForTransaction, fetchTransactions, t]
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
        treatment?: Transaction['treatment']
        refund_source?: Transaction['refund_source']
        linked_transaction_id?: string | null
        budget_effective_date?: string | null
        reviewed?: boolean
      },
      options: { closeOnSuccess?: boolean } = {}
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

        if (options.closeOnSuccess) {
          closeDetailDrawerForTransaction(transactionId)
        }
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
    [closeDetailDrawerForTransaction, t]
  )

  const handleSemanticsSave = useCallback(
    async (
      transactionId: string,
      payload: {
        treatment?: Transaction['treatment']
        refund_source?: Transaction['refund_source']
        transfer_match_status?: Transaction['transfer_match_status']
        existing_debt_payment?: boolean
      },
      options: { closeOnSuccess?: boolean } = {}
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

        if (options.closeOnSuccess) {
          closeDetailDrawerForTransaction(transactionId)
        }
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
    [closeDetailDrawerForTransaction, t]
  )

  const handleOpenSplitEditor = useCallback((tx: TransactionWithRelations) => {
    setCategorySaveStatus(null)
    setSimilarSuggestion(null)
    setEditingTransactionId(null)
    setSplitEditorTransaction(tx)
  }, [])

  const handleSplitSaved = useCallback(async () => {
    setSplitEditorTransaction(null)
    await fetchTransactions()
  }, [fetchTransactions])

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
          totalsByCurrency: new Map(),
        })
      }

      const group = groupMap.get(key)!
      group.transactions.push(tx)
      const currency = normalizeCurrencyCode(tx.iso_currency_code)
      group.totalsByCurrency.set(currency, (group.totalsByCurrency.get(currency) || 0) + Number(tx.amount))
    }

    return Array.from(groupMap.values()).sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.categoryName.localeCompare(b.categoryName)
    })
  }, [visibleTransactions, categories, categoryName])

  const pendingCount = serverViewCounts.pending || 0
  const aiPendingCount = allAiPendingCount
  const needsReviewCount = serverViewCounts.needs_review || 0
  const uncategorizedCount = serverViewCounts.uncategorized || 0
  const viewCountsLoading = loading && transactions.length === 0
  const aiStatusMessage =
    aiRefreshStatus ||
    (aiPendingCount > 0
      ? t('transactions.aiPendingSummary', {
          count: aiPendingCount,
          plural: aiPendingCount === 1 ? '' : 's',
          reason:
            aiJob?.error_message || t('transactions.aiPendingNoJobReason'),
        })
      : null)
  const aiQueueBusy = aiQueueActionLoading || aiQueueProcessing
  const showAiQueueDetails =
    aiQueueBusy ||
    Boolean(aiJob?.error_message) ||
    Boolean(aiJob && (aiJob.pending_count > 0 || aiJob.failed_count > 0))
  const hasTransactions = visibleTransactions.length > 0
  const hasMoreTransactions = transactions.length < totalCount
  const [detailEntryMode, setDetailEntryMode] = useState<'row' | 'category'>('row')
  const selectedTransaction = editingTransactionId
    ? transactions.find((tx) => tx.id === editingTransactionId) ?? null
    : null
  const activeFilterCount =
    (savedView !== 'all' ? 1 : 0) +
    (filters.search ? 1 : 0) +
    (filters.sourceOrAccount !== 'all' ? 1 : 0) +
    (filters.category !== 'all' ? 1 : 0) +
    (filters.currency !== 'all' ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0)
  const savedViewById = useMemo(
    () => new Map(SAVED_VIEWS.map((view) => [view.id, view])),
    []
  )
  const savedViewCountLabel = useCallback(
    (viewId: SavedView) => (
      viewCountsLoading ? '...' : String(serverViewCounts[viewId] ?? 0)
    ),
    [serverViewCounts, viewCountsLoading]
  )
  const getSavedViewGroupCount = useCallback(
    (viewIds: SavedView[]) => (
      viewCountsLoading
        ? '...'
        : String(viewIds.reduce((sum, viewId) => sum + (serverViewCounts[viewId] ?? 0), 0))
    ),
    [serverViewCounts, viewCountsLoading]
  )
  const renderSavedViewButton = useCallback(
    (viewId: SavedView, className = 'filter-chip-button') => {
      const view = savedViewById.get(viewId)
      if (!view) return null

      return (
        <button
          key={view.id}
          type="button"
          className={`${className} ${savedView === view.id ? 'active' : ''}`}
          onClick={() => setSavedView(view.id)}
        >
          <span>{t(view.labelKey)}</span>
          <span className="filter-chip-count">{savedViewCountLabel(view.id)}</span>
        </button>
      )
    },
    [savedView, savedViewById, savedViewCountLabel, t]
  )

  const clearAllFilters = useCallback(() => {
    setSavedView('all')
    setFilters({
      search: '',
      sourceOrAccount: 'all',
      category: 'all',
      currency: 'all',
      dateFrom: '',
      dateTo: '',
    })
    setAdvancedFiltersOpen(false)
  }, [])

  const activeFilterChips = useMemo(() => {
    const chips: Array<{
      key: string
      label: string
      onClear: () => void
    }> = []

    if (savedView !== 'all') {
      const activeView = SAVED_VIEWS.find((view) => view.id === savedView)
      if (activeView) {
        chips.push({
          key: `view:${savedView}`,
          label: t(activeView.labelKey),
          onClear: () => setSavedView('all'),
        })
      }
    }

    if (filters.search) {
      chips.push({
        key: 'search',
        label: filters.search,
        onClear: () => setFilters((current) => ({ ...current, search: '' })),
      })
    }

    if (filters.sourceOrAccount !== 'all') {
      const accountOption = accountOptions.find((account) => `account:${account.id}` === filters.sourceOrAccount)
      const sourceLabel =
        accountOption?.label ||
        (filters.sourceOrAccount === 'manual'
          ? t('common.manual')
          : filters.sourceOrAccount === 'receipt'
            ? t('common.receipt')
            : filters.sourceOrAccount)

      chips.push({
        key: 'source',
        label: sourceLabel,
        onClear: () => setFilters((current) => ({ ...current, sourceOrAccount: 'all' })),
      })
    }

    if (filters.category !== 'all') {
      const categoryLabel =
        filters.category === 'uncategorized'
          ? t('common.uncategorized')
          : categoryName(categories.find((category) => category.id === filters.category))

      chips.push({
        key: 'category',
        label: categoryLabel,
        onClear: () => setFilters((current) => ({ ...current, category: 'all' })),
      })
    }

    if (filters.currency !== 'all') {
      chips.push({
        key: 'currency',
        label: filters.currency,
        onClear: () => setFilters((current) => ({ ...current, currency: 'all' })),
      })
    }

    if (filters.dateFrom || filters.dateTo) {
      chips.push({
        key: 'date-range',
        label: [filters.dateFrom, filters.dateTo].filter(Boolean).join(' → '),
        onClear: () =>
          setFilters((current) => ({
            ...current,
            dateFrom: '',
            dateTo: '',
          })),
      })
    }

    return chips
  }, [accountOptions, categories, categoryName, filters, savedView, t])

  const attentionNotices = useMemo<AttentionNotice[]>(() => {
    const notices: AttentionNotice[] = []

    if (needsReviewCount > 0) {
      notices.push({
        key: 'needs-review',
        tone: 'warning',
        label: t('transactions.needsReview'),
        message: t('transactions.needsReviewSummary', { count: needsReviewCount }),
        actionLabel: t('transactions.openView'),
        actionKey: 'needs_review',
      })
    }

    if (uncategorizedCount > 0) {
      notices.push({
        key: 'uncategorized',
        tone: 'neutral',
        label: t('common.uncategorized'),
        message: t('transactions.uncategorizedSummary', { count: uncategorizedCount }),
        actionLabel: t('transactions.openView'),
        actionKey: 'uncategorized',
      })
    }

    if (aiPendingCount > 0 || showAiQueueDetails) {
      notices.push({
        key: 'ai-pending',
        tone: 'accent',
        label: t('transactions.aiPending'),
        message:
          aiStatusMessage ||
          t('transactions.aiPendingSummary', {
            count: aiPendingCount,
            plural: aiPendingCount === 1 ? '' : 's',
            reason: t('transactions.aiPendingNoJobReason'),
          }),
        actionLabel: aiPendingCount > 0 ? t('transactions.queueAiRefresh') : undefined,
        actionKey: aiPendingCount > 0 ? 'queue_ai' : undefined,
        busy: aiQueueBusy,
      })
    }

    if (pendingCount > 0) {
      notices.push({
        key: 'pending',
        tone: 'neutral',
        label: t('common.pending'),
        message: t('transactions.pendingSummary', { count: pendingCount }),
        actionLabel: t('transactions.openView'),
        actionKey: 'pending',
      })
    }

    return notices
  }, [
    aiPendingCount,
    aiQueueBusy,
    aiStatusMessage,
    needsReviewCount,
    pendingCount,
    showAiQueueDetails,
    t,
    uncategorizedCount,
  ])

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

  const handleOpenTransactionDetail = useCallback((transactionId: string) => {
    setCategorySaveStatus(null)
    setSimilarSuggestion(null)
    setDetailEntryMode('row')
    setEditingTransactionId(transactionId)
  }, [])

  const handleOpenCategoryDetail = useCallback((transactionId: string) => {
    setCategorySaveStatus(null)
    setSimilarSuggestion(null)
    setDetailEntryMode('category')
    setEditingTransactionId(transactionId)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setEditingTransactionId(null)
    setDetailEntryMode('row')
    setSimilarSuggestion(null)
    if (!focusedTransactionId) return
    setFocusedTransactionId('')
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('tx')
    const query = nextParams.toString()
    router.replace(query ? `/transactions?${query}` : '/transactions', { scroll: false })
  }, [focusedTransactionId, router, searchParams])

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
        categories={assignableCategories}
        categoriesLoading={categoriesLoading}
        isEditing={false}
        isSaving={savingTransactionId === tx.id}
        statusMessage={
          categorySaveStatus?.transactionId === tx.id && editingTransactionId !== tx.id
            ? categorySaveStatus.message
            : null
        }
        similarSuggestion={
          similarSuggestion?.transactionId === tx.id && editingTransactionId !== tx.id ? similarSuggestion : null
        }
        onSaveCategory={handleCategorySave}
        onApplySimilar={handleCategorySave}
        onDismissSimilar={handleDismissSimilar}
        onCreateCategory={handleCreateCategory}
        onSaveRefundMetadata={handleRefundMetadataSave}
        onSaveSemantics={handleSemanticsSave}
        onOpenSplitEditor={handleOpenSplitEditor}
        onOpenDetails={handleOpenTransactionDetail}
        onOpenCategoryDetails={handleOpenCategoryDetail}
        categoryName={categoryName}
        t={t}
      />
    ),
    [
      assignableCategories,
      categoriesLoading,
      categorySaveStatus,
      editingTransactionId,
      handleCategorySave,
      handleCreateCategory,
      handleDismissSimilar,
      handleRefundMetadataSave,
      handleSemanticsSave,
      handleOpenSplitEditor,
      handleOpenCategoryDetail,
      handleOpenTransactionDetail,
      categoryName,
      linkCandidatesByTransactionId,
      t,
      savingTransactionId,
      similarSuggestion,
    ]
  )

  return (
    <div className="transactions-page">
      <PageHeader title={t('transactions.title')} />

      {attentionNotices.length > 0 && (
        <section className="transactions-attention-strip" aria-label={t('transactions.attentionAria')}>
          {attentionNotices.map((notice) => (
            <div key={notice.key} className={`attention-card attention-${notice.tone}`}>
              <div className="attention-card-copy">
                <span className="attention-card-label">{notice.label}</span>
                <p>{notice.message}</p>
                {notice.key === 'ai-pending' && showAiQueueDetails && aiJob && (
                  <span className="attention-card-meta">
                    {t('transactions.total')} {aiJob.total_count} · {t('common.pending')} {aiJob.pending_count} · {t('transactions.done')} {aiJob.completed_count} · {t('transactions.failed')} {aiJob.failed_count}
                  </span>
                )}
              </div>
              {notice.actionKey && notice.actionLabel && (
                <button
                  type="button"
                  className={`btn btn-sm ${notice.tone === 'warning' || notice.tone === 'accent' ? 'btn-primary' : 'btn-ghost'}`}
                  disabled={notice.busy}
                  onClick={() => {
                    if (notice.actionKey === 'needs_review') {
                      setSavedView('needs_review')
                    } else if (notice.actionKey === 'uncategorized') {
                      setSavedView('uncategorized')
                    } else if (notice.actionKey === 'pending') {
                      setSavedView('pending')
                    } else if (notice.actionKey === 'queue_ai') {
                      handleQueueAiRefresh()
                    }
                  }}
                  title={notice.key === 'ai-pending' ? t('transactions.queueAiTitle') : undefined}
                >
                  {notice.busy ? t('transactions.processingAi') : notice.actionLabel}
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {loadError && (
        <div className="alert alert-error">{loadError}</div>
      )}

      <div className="card filters-bar transactions-filter-card">
        <div className="transactions-filter-toolbar">
          <div className="saved-view-row transaction-view-row" aria-label={t('transactions.savedViewsAria')}>
            {PRIMARY_SAVED_VIEW_IDS.map((viewId) => renderSavedViewButton(viewId))}
            {SAVED_VIEW_GROUPS.map((group) => {
              const isActiveGroup = group.views.includes(savedView)

              return (
                <details
                  key={group.id}
                  className={`saved-view-group ${isActiveGroup ? 'active' : ''}`}
                  open={isActiveGroup || undefined}
                >
                  <summary className="filter-chip-button saved-view-group-summary">
                    <span>{t(group.labelKey)}</span>
                    <span className="filter-chip-count">{getSavedViewGroupCount(group.views)}</span>
                  </summary>
                  <div className="saved-view-group-menu">
                    {group.views.map((viewId) =>
                      renderSavedViewButton(viewId, 'filter-chip-button saved-view-subitem')
                    )}
                  </div>
                </details>
              )
            })}
          </div>
        </div>
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
        <div className="transactions-filter-actions">
          <div className="segmented-control" aria-label={t('transactions.groupByAria')}>
            <button
              type="button"
              className={groupBy === 'date' ? 'active' : ''}
              onClick={() => setGroupBy('date')}
            >
              {t('transactions.date')}
            </button>
            <button
              type="button"
              className={groupBy === 'category' ? 'active' : ''}
              onClick={() => setGroupBy('category')}
            >
              {t('transactions.category')}
            </button>
          </div>
          <div className="transactions-filter-action-buttons">
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={clearAllFilters}
              >
                {t('transactions.clearAllFilters')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setAdvancedFiltersOpen((open) => !open)}
              aria-expanded={advancedFiltersOpen}
            >
              {advancedFiltersOpen ? t('transactions.hideFilters') : t('transactions.showFilters')}
            </button>
          </div>
        </div>
        {activeFilterChips.length > 0 && (
          <div className="active-filter-row" aria-label={t('transactions.activeFiltersAria')}>
            {activeFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="active-filter-chip"
                onClick={chip.onClear}
              >
                <span>{chip.label}</span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        )}
        {advancedFiltersOpen && <div className="filter-row">
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
        </div>}
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
                const dayTotals = sumByCurrency(txs, (tx) => Number(tx.amount), (tx) => tx.iso_currency_code)
                return (
                  <div key={date} className="transaction-group">
                    <div className="group-header">
                      <span className="group-date">{formatDate(date)}</span>
                      <span className="group-summary">
                        {formatGroupSummary(txs, dayTotals, t)}
                      </span>
                    </div>
                    <div className="card transaction-list-card">
                      {txs.map(renderTransactionItem)}
                    </div>
                  </div>
                )
              })
            : visibleTransactionsGroupedByCategory.map((group) => {
                const groupTotal = totalOfCurrencyMap(group.totalsByCurrency)
                const groupHasMultipleCurrencies = hasMultipleCurrencies(group.totalsByCurrency)

                return (
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
                      <span className={`group-total ${groupHasMultipleCurrencies ? '' : groupTotal <= 0 ? 'income' : 'expense'}`}>
                        {formatCurrencyTotals(group.totalsByCurrency, (amount) => -amount)}
                      </span>
                    </div>
                    <div className="card transaction-list-card">
                      {group.transactions.map(renderTransactionItem)}
                    </div>
                  </div>
                )
              })}
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
      {splitEditorTransaction && (
        <SplitEditorDrawer
          transaction={splitEditorTransaction}
          categories={assignableCategories}
          categoryName={categoryName}
          t={t}
          onClose={() => setSplitEditorTransaction(null)}
          onSaved={handleSplitSaved}
        />
      )}
      <Drawer
        open={Boolean(selectedTransaction)}
        title={t('transactions.transactionDetails')}
        onClose={handleCloseDetail}
        className="transaction-detail-panel"
      >
        {selectedTransaction && (
          <TransactionItem
            key={`${selectedTransaction.id}:${detailEntryMode}`}
            transaction={selectedTransaction}
            linkCandidates={
              linkCandidatesByTransactionId.get(selectedTransaction.id) || EMPTY_LINK_CANDIDATES
            }
            categories={assignableCategories}
            categoriesLoading={categoriesLoading}
            isEditing
            isSaving={savingTransactionId === selectedTransaction.id}
            statusMessage={
              categorySaveStatus?.transactionId === selectedTransaction.id
                ? categorySaveStatus.message
                : null
            }
            similarSuggestion={
              similarSuggestion?.transactionId === selectedTransaction.id ? similarSuggestion : null
            }
            onSaveCategory={handleCategorySave}
            onApplySimilar={handleCategorySave}
            onDismissSimilar={handleDismissSimilar}
            onCreateCategory={handleCreateCategory}
            onSaveRefundMetadata={handleRefundMetadataSave}
            onSaveSemantics={handleSemanticsSave}
            onOpenSplitEditor={handleOpenSplitEditor}
            onOpenDetails={handleOpenTransactionDetail}
            onOpenCategoryDetails={handleOpenCategoryDetail}
            categoryName={categoryName}
            t={t}
            detailMode
            defaultCategoryOpen={detailEntryMode === 'category'}
          />
        )}
      </Drawer>
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
  onSaveCategory,
  onApplySimilar,
  onDismissSimilar,
  onCreateCategory,
  onSaveRefundMetadata,
  onSaveSemantics,
  onOpenSplitEditor,
  onOpenDetails,
  onOpenCategoryDetails,
  categoryName,
  t,
  detailMode = false,
  defaultCategoryOpen = false,
}: {
  transaction: TransactionWithRelations
  linkCandidates: RefundLinkCandidate[]
  categories: Category[]
  categoriesLoading: boolean
  isEditing: boolean
  isSaving: boolean
  statusMessage: string | null
  similarSuggestion: SimilarCategorySuggestion | null
  onSaveCategory: (
    transactionId: string,
    categoryId: string,
    applyMode?: 'single' | 'similar',
    options?: { closeOnSuccess?: boolean }
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
      treatment?: Transaction['treatment']
      refund_source?: Transaction['refund_source']
      linked_transaction_id?: string | null
      budget_effective_date?: string | null
      reviewed?: boolean
    },
    options?: { closeOnSuccess?: boolean }
  ) => void
  onSaveSemantics: (
    transactionId: string,
    payload: {
      treatment?: Transaction['treatment']
      refund_source?: Transaction['refund_source']
      transfer_match_status?: Transaction['transfer_match_status']
      existing_debt_payment?: boolean
    },
    options?: { closeOnSuccess?: boolean }
  ) => void
  onOpenSplitEditor: (transaction: TransactionWithRelations) => void
  onOpenDetails: (transactionId: string) => void
  onOpenCategoryDetails: (transactionId: string) => void
  categoryName: (category?: { name?: string | null; name_zh?: string | null } | null, fallback?: string) => string
  t: (key: string, params?: Record<string, string | number>) => string
  detailMode?: boolean
  defaultCategoryOpen?: boolean
}) {
  const amount = Number(tx.amount)
  const isIncome = amount < 0
  const displayAmount = -amount
  const isDisplayedCredit = displayAmount > 0
  const treatment = getTxTreatment(tx)
  const refundSource = getTxRefundSource(tx)
  const categoryIcon = tx.categories?.icon || '📦'
  const displayCategoryName = categoryName(tx.categories)
  const merchantName = tx.merchant_name || tx.description
  const accountLabel = tx.accounts
    ? formatAccountSourceLabel(tx.accounts, t('common.manual'), t('common.account'))
    : null
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

  const hasAutomaticClassificationTag =
    tags.includes(AI_PENDING_TAG) || tags.includes(PLAID_FALLBACK_TAG)
  const hasRefundReview = needsRefundReview(tx)
  const hasTransferReview = needsTransferReview(tx)
  const needsReviewBadge = hasTransactionNeedsReviewBadge(tx)

  const badgeParts = getTransactionBadgeParts(tx, t)

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

  if (tx.source === 'receipt') {
    metaParts.push(t('common.receipt'))
  } else if (tx.source === 'manual' && !accountLabel) {
    metaParts.push(t('common.manual'))
  }
  if (!needsReviewBadge && tx.transfer_match_status === 'ignored') {
    pushMetaPart(t('common.notTransfer'))
  }
  const metaText = metaParts.join(' · ')
  const showRefundControls =
    isDisplayedCredit &&
    treatment === 'refund'
  const reviewActions = [
    !tx.category_id || hasAutomaticClassificationTag
      ? {
          key: 'category',
          title: !tx.category_id
            ? t('transactions.reviewCategoryTitle')
            : t('transactions.reviewAiTitle'),
          copy: !tx.category_id
            ? t('transactions.reviewCategoryCopy')
            : t('transactions.reviewAiCopy'),
          actions:
            tx.category_id && hasAutomaticClassificationTag
              ? [
                  {
                    label: t('transactions.confirmCategory'),
                    variant: 'primary',
                    onClick: () => {
                      if (tx.category_id) {
                        onSaveCategory(tx.id, tx.category_id, 'single', {
                          closeOnSuccess: true,
                        })
                      }
                    },
                    disabled: isSaving,
                  },
                ]
              : [],
        }
      : null,
    hasTransferReview
      ? {
          key: 'transfer',
          title: t('transactions.reviewTransferTitle'),
          copy: tx.transfer_match_reason || t('transactions.reviewTransferCopy'),
          actions: [
            {
              label: t('transactions.confirmTransfer'),
              variant: 'primary',
              onClick: () =>
                onSaveSemantics(tx.id, {
                  transfer_match_status: 'manually_matched',
                }, {
                  closeOnSuccess: true,
                }),
              disabled: isSaving,
            },
            {
              label: t('transactions.notTransfer'),
              variant: 'ghost',
              onClick: () =>
                onSaveSemantics(tx.id, {
                  treatment: 'spending',
                  transfer_match_status: 'ignored',
                }, {
                  closeOnSuccess: true,
                }),
              disabled: isSaving,
            },
          ],
        }
      : null,
    hasRefundReview
      ? {
          key: 'refund',
          title: t('transactions.reviewRefundTitle'),
          copy: tx.linked_transaction_id
            ? t('transactions.reviewRefundLinkedCopy')
            : t('transactions.reviewRefundCopy'),
          actions: [
            {
              label: t('transactions.confirmRefund'),
              variant: 'primary',
              onClick: () =>
                onSaveRefundMetadata(tx.id, {
                  reviewed: true,
                }, {
                  closeOnSuccess: true,
                }),
              disabled: isSaving,
            },
            {
              label: t('transactions.notRefund'),
              variant: 'ghost',
              onClick: () =>
                onSaveRefundMetadata(tx.id, {
                  treatment: 'spending',
                }, {
                  closeOnSuccess: true,
                }),
              disabled: isSaving,
            },
          ],
        }
      : null,
    tx.pending
      ? {
          key: 'pending',
          title: t('transactions.reviewPendingTitle'),
          copy: t('transactions.reviewPendingCopy'),
          actions: [],
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string
    title: string
    copy: string
    actions: Array<{
      label: string
      variant: 'primary' | 'ghost'
      onClick: () => void
      disabled: boolean
    }>
  }>

  const renderReviewActions = (panelClassName = 'review-action-panel') => (
    <div className={panelClassName}>
      <div className="review-action-panel-header">
        <span>{t('transactions.recommendedActions')}</span>
        {isSaving && <span>{t('common.saving')}</span>}
      </div>
      <div className="review-action-list">
        {reviewActions.map((action) => (
          <div key={action.key} className="review-action-item">
            <div className="review-action-copy">
              <strong>{action.title}</strong>
              <span>{action.copy}</span>
            </div>
            {action.actions.length > 0 && (
              <div className="review-action-buttons">
                {action.actions.map((button) => (
                  <button
                    key={button.label}
                    type="button"
                    className={`btn btn-sm ${button.variant === 'primary' ? 'btn-primary' : 'btn-ghost'}`}
                    disabled={button.disabled}
                    onClick={button.onClick}
                  >
                    {button.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  const renderStatusFeedback = (detailFeedback = false) => (
    (statusMessage || similarSuggestion) && (
      <div className={detailFeedback ? 'detail-feedback-bar' : 'inline-similar-suggestion'}>
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
    )
  )

  const [openSections, setOpenSections] = useState<Record<DetailSectionKey, boolean>>(
    () => ({
      category: defaultCategoryOpen || !tx.category_id || hasAutomaticClassificationTag,
      semantics: hasRefundReview || hasTransferReview || isDisplayedCredit,
      split: Boolean(tx.split_group_id || tx.split_status === 'out_of_balance'),
    })
  )

  const toggleSection = (section: DetailSectionKey) => {
    setOpenSections((current) => ({
      ...current,
      [section]: !current[section],
    }))
  }

  const rowBadges = badgeParts.slice(0, needsReviewBadge ? 2 : 1)
  const detailBadges = badgeParts.slice(0, 4)

  if (detailMode) {
    return (
      <div className="transaction-command-sheet">
        <div className="transaction-command-hero">
          <div className="transaction-command-icon">{categoryIcon}</div>
          <div className="transaction-command-copy">
            <span className="transaction-command-merchant">{merchantName}</span>
            {metaText && <span className="transaction-command-meta">{metaText}</span>}
            <span className="transaction-command-badges">
              <Badge tone="accent">
                <span>{categoryIcon}</span>
                <span>{displayCategoryName}</span>
              </Badge>
              {detailBadges.map((badge) => (
                <Badge key={badge.label} tone={badge.tone}>{badge.label}</Badge>
              ))}
            </span>
          </div>
          <div className={`transaction-command-amount ${isIncome ? 'income' : 'expense'}`}>
            {formatCurrency(displayAmount, tx.iso_currency_code || 'USD')}
          </div>
        </div>

        {reviewActions.length > 0 && renderReviewActions('review-action-panel detail-card detail-review-card')}

        <section className={`detail-card category-command-card ${openSections.category ? 'expanded' : 'collapsed'}`}>
          <button
            type="button"
            className="detail-section-toggle"
            aria-expanded={openSections.category}
            onClick={() => toggleSection('category')}
          >
            <div className="detail-card-header">
              <div>
                <h3>{t('transactions.pickCategory')}</h3>
                <p>{t('transactions.categoryCommandHint')}</p>
              </div>
              <div className="detail-section-meta">
                {isSaving && <span>{t('common.saving')}</span>}
                <span className="detail-section-chevron" aria-hidden="true">⌄</span>
              </div>
            </div>
          </button>
          {openSections.category && (
            <div className="detail-section-body">
              {categoriesLoading ? (
                <p className="text-secondary">{t('transactions.loadingCategories')}</p>
              ) : (
                <div className="tx-category-options detail-category-options">
                  {categories.map((category) => {
                    const isSelected = category.id === tx.category_id
                    return (
                      <button
                        key={category.id}
                        type="button"
                        className={`category-chip detail-category-option ${isSelected ? 'selected' : ''}`}
                        disabled={isSaving}
                        onClick={() => onSaveCategory(tx.id, category.id)}
                      >
                        <span className="category-chip-icon">{category.icon || '📦'}</span>
                        <span className="category-chip-label">
                          {categoryName(category)}
                        </span>
                        {category.is_excluded_from_budget && (
                          <span className="category-chip-badge">{t('transactions.excludedShort')}</span>
                        )}
                        {isSelected && <span className="category-selected-mark">✓</span>}
                      </button>
                    )
                  })}
                </div>
              )}
              <div className="new-category-section detail-new-category-section">
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
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="new-category-toggle detail-new-category-toggle"
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
        </section>

        <section className={`detail-card semantic-command-card ${openSections.semantics ? 'expanded' : 'collapsed'}`}>
          <button
            type="button"
            className="detail-section-toggle"
            aria-expanded={openSections.semantics}
            onClick={() => toggleSection('semantics')}
          >
            <div className="detail-card-header">
              <div>
                <h3>{isDisplayedCredit ? t('transactions.creditMeaning') : t('transactions.budgetMeaning')}</h3>
                <p>{isDisplayedCredit ? t('transactions.creditMeaningHint') : t('transactions.budgetMeaningHint')}</p>
              </div>
              <div className="detail-section-meta">
                {isSaving && <span>{t('common.saving')}</span>}
                <span className="detail-section-chevron" aria-hidden="true">⌄</span>
              </div>
            </div>
          </button>
          {openSections.semantics && (
            <div className="detail-section-body">
              <div className="semantic-option-grid">
            {isDisplayedCredit ? (
              <>
                <button
                  type="button"
                  className={`semantic-option ${treatment === 'refund' && refundSource !== 'reimbursement' ? 'selected' : ''}`}
                  disabled={isSaving}
                  onClick={() =>
                    onSaveRefundMetadata(tx.id, {
                      treatment: 'refund',
                      refund_source: 'merchant_refund',
                    })
                  }
                >
                  <strong>{t('common.refund')}</strong>
                  <span>{t('transactions.refundOptionHint')}</span>
                </button>
                <button
                  type="button"
                  className={`semantic-option ${treatment === 'refund' && refundSource === 'reimbursement' ? 'selected' : ''}`}
                  disabled={isSaving}
                  onClick={() =>
                    onSaveRefundMetadata(tx.id, {
                      treatment: 'refund',
                      refund_source: 'reimbursement',
                    })
                  }
                >
                  <strong>{t('common.reimbursement')}</strong>
                  <span>{t('transactions.reimbursementOptionHint')}</span>
                </button>
                <button
                  type="button"
                  className={`semantic-option ${treatment === 'income' ? 'selected' : ''}`}
                  disabled={isSaving}
                  onClick={() => onSaveSemantics(tx.id, { treatment: 'income' })}
                >
                  <strong>{t('transactions.incomeOption')}</strong>
                  <span>{t('transactions.incomeOptionHint')}</span>
                </button>
                <button
                  type="button"
                  className={`semantic-option ${treatment === 'transfer' ? 'selected' : ''}`}
                  disabled={isSaving}
                  onClick={() => onSaveSemantics(tx.id, { treatment: 'transfer' })}
                >
                  <strong>{t('transactions.internalTransfer')}</strong>
                  <span>{t('transactions.internalTransferHint')}</span>
                </button>
                <button
                  type="button"
                  className={`semantic-option ${treatment === 'excluded' ? 'selected' : ''}`}
                  disabled={isSaving}
                  onClick={() => onSaveSemantics(tx.id, { treatment: 'excluded' })}
                >
                  <strong>{t('transactions.exclude')}</strong>
                  <span>{t('transactions.excludeOptionHint')}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`semantic-option ${treatment === 'spending' ? 'selected' : ''}`}
                  disabled={isSaving}
                  onClick={() => onSaveSemantics(tx.id, { treatment: 'spending' })}
                >
                  <strong>{t('transactions.spendingOption')}</strong>
                  <span>{t('transactions.spendingOptionHint')}</span>
                </button>
                <button
                  type="button"
                  className={`semantic-option ${treatment === 'transfer' ? 'selected' : ''}`}
                  disabled={isSaving}
                  onClick={() => onSaveSemantics(tx.id, { treatment: 'transfer' })}
                >
                  <strong>{t('transactions.internalTransfer')}</strong>
                  <span>{t('transactions.internalTransferHint')}</span>
                </button>
                <button
                  type="button"
                  className={`semantic-option ${treatment === 'excluded' ? 'selected' : ''}`}
                  disabled={isSaving}
                  onClick={() => onSaveSemantics(tx.id, { treatment: 'excluded' })}
                >
                  <strong>{t('transactions.exclude')}</strong>
                  <span>{t('transactions.excludeOptionHint')}</span>
                </button>
                <button
                  type="button"
                  className="semantic-option"
                  disabled={isSaving}
                  onClick={() =>
                    onSaveSemantics(tx.id, {
                      existing_debt_payment: true,
                    })
                  }
                >
                  <strong>{t('transactions.existingDebt')}</strong>
                  <span>{t('transactions.existingDebtHint')}</span>
                </button>
              </>
            )}
              </div>

              {showRefundControls && (
                <div className="refund-detail-controls">
                  {tx.linked_transaction_id && (
                    <p className="refund-hint">
                      {t('transactions.appliedOriginalBudget')}
                      {tx.refund_match_confidence != null &&
                        tx.refund_match_confidence < 0.8 &&
                        tx.refund_match_reason &&
                        ` · ${t('transactions.possibleRefundMatch', { reason: tx.refund_match_reason })}`}
                    </p>
                  )}
                  <label className="field-row">
                    <span>{t('transactions.originalPurchase')}</span>
                    <div className="refund-link-row compact">
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
                        {t('transactions.link')}
                      </button>
                      {tx.linked_transaction_id && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={isSaving}
                          onClick={() => {
                            setRefundFormDraft({
                              ...syncedRefundFormDraft,
                              selectedLinkId: '',
                              budgetEffectiveDate: tx.date,
                            })
                            onSaveRefundMetadata(tx.id, { linked_transaction_id: null })
                          }}
                        >
                          {t('transactions.clear')}
                        </button>
                      )}
                    </div>
                  </label>
                  <label className="field-row">
                    <span>{t('transactions.budgetDate')}</span>
                    <div className="refund-link-row compact">
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
                            reviewed: true,
                          })
                        }
                      >
                        {t('transactions.applyDate')}
                      </button>
                    </div>
                  </label>
                </div>
              )}

              {(tx.transfer_match_reason || (tx.transfer_match_status && tx.transfer_match_status !== 'ignored')) && (
                <div className="transfer-detail-controls">
                  {tx.transfer_match_reason && (
                    <p className="refund-hint">{tx.transfer_match_reason}</p>
                  )}
                  <div className="refund-kind-actions">
                    {tx.transfer_match_status && tx.transfer_match_status !== 'ignored' && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={isSaving}
                        onClick={() =>
                          onSaveSemantics(tx.id, {
                            treatment: 'spending',
                            transfer_match_status: 'ignored',
                          })
                        }
                      >
                        {t('transactions.notTransfer')}
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
                        {t('transactions.confirmMatch')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className={`detail-card split-action-card ${tx.pending ? 'disabled' : ''} ${openSections.split ? 'expanded' : 'collapsed'}`}>
          <button
            type="button"
            className="detail-section-toggle"
            aria-expanded={openSections.split}
            onClick={() => {
              if (tx.pending) {
                toggleSection('split')
                return
              }

              if (!openSections.split) {
                setOpenSections((current) => ({
                  ...current,
                  split: true,
                }))
                onOpenSplitEditor(tx)
                return
              }

              toggleSection('split')
            }}
          >
            <div className="detail-card-header split-action-header">
              <div>
                <h3>{t('transactions.splitSectionTitle')}</h3>
                <p>{tx.pending ? t('transactions.splitPendingDisabled') : t('transactions.splitSectionHint')}</p>
              </div>
              <div className="detail-section-meta">
                {tx.split_status && <Badge tone={tx.split_status === 'out_of_balance' ? 'warning' : 'muted'}>{tx.split_status}</Badge>}
                <span className="detail-section-chevron" aria-hidden="true">⌄</span>
              </div>
            </div>
          </button>
          {openSections.split && (
            <div className="detail-section-body">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                title={tx.pending ? t('transactions.splitPendingDisabled') : t('transactions.splitAction')}
                aria-label={tx.pending ? t('transactions.splitPendingDisabled') : t('transactions.splitAction')}
                disabled={tx.pending}
                onClick={() => onOpenSplitEditor(tx)}
              >
                {tx.split_group_id ? t('transactions.editSplit') : t('transactions.splitAction')}
              </button>
            </div>
          )}
        </section>

        {renderStatusFeedback(true)}
      </div>
    )
  }

  return (
    <div className="transaction-item">
      <div
        className="tx-row-main tx-row-clickable"
        role="button"
        tabIndex={0}
        onClick={() => onOpenDetails(tx.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpenDetails(tx.id)
          }
        }}
      >
        <div className="tx-icon">{categoryIcon}</div>
        <div className="tx-details">
          <span className="tx-merchant">{merchantName}</span>
          {metaText && <span className="tx-meta">{metaText}</span>}
          {rowBadges.length > 0 && (
            <span className="tx-badges">
              {rowBadges.map((badge) => (
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
            }) as Category
          )}
          aria-expanded={isEditing}
          aria-label={t('transactions.changeCategoryAria', { merchant: merchantName })}
          onClick={(event) => {
            event.stopPropagation()
            onOpenCategoryDetails(tx.id)
          }}
        >
          <span className="tx-category-pill-icon">{categoryIcon}</span>
          <span className="tx-category-pill-label">{displayCategoryName}</span>
          <span className="tx-category-pill-chevron" aria-hidden="true">›</span>
        </button>
        <div className={`tx-amount ${isIncome ? 'income' : 'expense'}`}>
          {formatCurrency(displayAmount, tx.iso_currency_code || 'USD')}
        </div>
      </div>
      {renderStatusFeedback(false)}
    </div>
  )
})
