'use client'

import Link from 'next/link'
import { forwardRef, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { formatCurrency } from '@/lib/currency'
import type { CategoryBudgetSummary, MonthlyBudgetSummary } from '@/modules/budget/budget.types'
import { useI18n } from '@/i18n/client'

function toMonthParam(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function toUtcMonthParam(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function subscribeCurrentMonth() {
  return () => {}
}

function getClientCurrentMonth() {
  return toMonthParam(new Date())
}

function getServerCurrentMonth() {
  return toUtcMonthParam(new Date())
}

function formatMonthLabel(monthParam: string, locale: string): string {
  const [year, month] = monthParam.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

function addMonths(monthParam: string, delta: number): string {
  const [year, month] = monthParam.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return toMonthParam(date)
}

function getStatusTone(status: CategoryBudgetSummary['status']) {
  if (status === 'under') return 'success' as const
  if (status === 'near') return 'warning' as const
  if (status === 'over') return 'danger' as const
  return 'neutral' as const
}

function getHealth(summary: MonthlyBudgetSummary | undefined) {
  if (!summary || summary.totalBaseBudget <= 0 || summary.totalPercentUsed === null) {
    return { labelKey: 'budgets.notConfigured', tone: 'neutral' as const, copyKey: 'budgets.setGuidance' }
  }
  if (summary.totalActualSpend > summary.totalBaseBudget) {
    return { labelKey: 'budgets.over', tone: 'danger' as const, copyKey: 'budgets.overCopy' }
  }
  if (summary.totalPercentUsed >= 0.8) {
    return { labelKey: 'budgets.watch', tone: 'warning' as const, copyKey: 'budgets.watchCopy' }
  }
  return { labelKey: 'budgets.safe', tone: 'success' as const, copyKey: 'budgets.safeCopy' }
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Failed to load budget data (${res.status})`)
  return json as MonthlyBudgetSummary
}

function buildCategoryLink(categoryId: string, categoryName: string) {
  const query = new URLSearchParams()
  if (categoryId) {
    query.set('category', categoryId)
  } else if (categoryName) {
    query.set('category', categoryName)
  }
  return `/transactions?${query.toString()}`
}

function getGroupLabel(
  group: 'over' | 'watch' | 'onTrack' | 'noBudget',
  locale: string
) {
  switch (group) {
    case 'over':
      return locale === 'zh' ? '超支' : 'Over'
    case 'watch':
      return locale === 'zh' ? '需关注' : 'Watch'
    case 'onTrack':
      return locale === 'zh' ? '正常' : 'On track'
    case 'noBudget':
    default:
      return locale === 'zh' ? '未设置预算' : 'No budget'
  }
}

export default function BudgetsPage() {
  const { categoryName, locale, t } = useI18n()
  const currentMonth = useSyncExternalStore(
    subscribeCurrentMonth,
    getClientCurrentMonth,
    getServerCurrentMonth
  )
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const month = selectedMonth ?? currentMonth
  const { data: summary, error: swrError, isLoading: loading, mutate } = useSWR<MonthlyBudgetSummary>(
    `/api/budget/monthly-summary?month=${month}`,
    fetcher
  )
  const error = swrError?.message || null
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function handlePrevMonth() {
    setSelectedMonth((m) => addMonths(m ?? month, -1))
  }

  function handleNextMonth() {
    setSelectedMonth((m) => addMonths(m ?? month, 1))
  }

  function startEdit(cat: CategoryBudgetSummary) {
    setSaveError(null)
    setEditingId(cat.categoryId)
    setEditValue(String(cat.baseBudget))
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValue('')
  }

  async function commitEdit(categoryId: string) {
    const amount = parseFloat(editValue)
    if (isNaN(amount) || amount < 0) {
      setSaveError(t('budgets.nonNegative'))
      return
    }

    setSaving(true)
    setSaveError(null)

    try {
      const res = await fetch('/api/budget/category-budget', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId, month, amount }),
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || `Save failed (${res.status})`)
      }

      setEditingId(null)
      setEditValue('')
      mutate()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('budgets.updateError')
      setSaveError(message)
      console.error('Failed to update budget:', err)
    } finally {
      setSaving(false)
    }
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>, categoryId: string) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitEdit(categoryId)
    } else if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  function openCategoryDetail(categoryId: string) {
    setSelectedCategoryId(categoryId)
  }

  const visibleCategories = summary?.categories ?? []
  const selectedCategory =
    selectedCategoryId
      ? visibleCategories.find((category) => category.categoryId === selectedCategoryId) ?? null
      : null
  const health = getHealth(summary)
  const groupedCategories = {
    over: visibleCategories.filter((category) => category.status === 'over'),
    watch: visibleCategories.filter((category) => category.status === 'near'),
    onTrack: visibleCategories.filter((category) => category.status === 'under'),
    noBudget: visibleCategories.filter((category) => category.status === 'no_budget'),
  }

  const sectionOrder: Array<'over' | 'watch' | 'onTrack' | 'noBudget'> = [
    'over',
    'watch',
    'onTrack',
    'noBudget',
  ]

  const monthlyLabel = formatMonthLabel(month, locale === 'zh' ? 'zh-CN' : 'en-US')
  const hasBudget = summary?.totalBaseBudget && summary.totalBaseBudget > 0

  return (
    <div className="budgets-page">
      <PageHeader
        title={t('budgets.title')}
        subtitle={t('budgets.subtitle')}
        actions={
          <div className="page-header-actions">
            <Button variant="ghost" size="sm" onClick={handlePrevMonth} aria-label={t('budgets.prevMonth')}>
              ‹
            </Button>
            <span className="topbar-status">{monthlyLabel}</span>
            <Button variant="ghost" size="sm" onClick={handleNextMonth} aria-label={t('budgets.nextMonth')}>
              ›
            </Button>
          </div>
        }
      />

      {loading && <div className="skeleton-card" />}
      {!loading && error && <div className="alert alert-error">{error}</div>}
      {!loading && !error && saveError && <div className="alert alert-error">{saveError}</div>}

      {!loading && !error && summary && (
        <>
          <Card className="budget-health-card budget-health-card-prominent" padding="lg">
            <div className="budget-health-status">
              <Badge tone={health.tone}>{t(health.labelKey)}</Badge>
              <strong>
                {summary.totalPercentUsed === null
                  ? t('budgets.noPlanYet')
                  : t('budgets.used', { percent: Math.round(summary.totalPercentUsed * 100) })}
              </strong>
              <p className="text-secondary">{t(health.copyKey)}</p>
            </div>
            <div className="budget-health-meter">
              <div className="budget-health-metrics">
                <div>
                  <span className="metric-label">{t('budgets.totalBudget')}</span>
                  <span className="metric-value">
                    {formatCurrency(summary.totalBaseBudget, summary.currencyCode)}
                  </span>
                </div>
                <div>
                  <span className="metric-label">{t('budgets.spent')}</span>
                  <span className="metric-value">
                    {formatCurrency(summary.totalActualSpend, summary.currencyCode)}
                  </span>
                </div>
                <div>
                  <span className="metric-label">{t('budgets.remaining')}</span>
                  <span
                    className="metric-value"
                    style={{
                      color: summary.totalRemaining < 0 ? 'var(--expense)' : 'var(--income)',
                    }}
                  >
                    {formatCurrency(summary.totalRemaining, summary.currencyCode)}
                  </span>
                </div>
              </div>
              <ProgressBar
                value={summary.totalPercentUsed}
                tone={health.tone}
                label={t('budgets.monthlyProgress')}
              />
              {summary.totalRemaining < 0 && (
                <p className="budget-note">{t('budgets.negativeRemaining')}</p>
              )}
            </div>
          </Card>

          {visibleCategories.length === 0 ? (
            <EmptyState
              title={t('budgets.noCategoriesTitle')}
            >
              {t('budgets.noCategoriesCopy', { month: monthlyLabel })}
            </EmptyState>
          ) : sectionOrder.map((group) => {
            const items = groupedCategories[group]
            const groupLabel = getGroupLabel(group, locale)

            return (
              <Card key={group} padding="md">
                <div className="card-header budget-section-header">
                  <div>
                    <h3>
                      {groupLabel}
                      <span className="badge badge-muted" style={{ marginLeft: '0.5rem' }}>
                        {items.length}
                      </span>
                    </h3>
                    <p className="card-subtitle">
                      {group === 'over'
                        ? t('budgets.overCopy')
                        : group === 'watch'
                          ? t('budgets.watchCopy')
                          : group === 'onTrack'
                            ? t('budgets.safeCopy')
                            : t('budgets.setGuidance')}
                    </p>
                  </div>
                </div>

                {items.length === 0 ? (
                  <EmptyState title={groupLabel}>
                    {group === 'noBudget'
                      ? t('budgets.noCategoriesCopy', { month: monthlyLabel })
                      : t('budgets.safeCopy')}
                  </EmptyState>
                ) : (
                  <div className="budget-risk-list">
                    {items
                      .slice()
                      .sort((a, b) => (b.percentUsed ?? -1) - (a.percentUsed ?? -1))
                      .map((category) => {
                        const displayCategoryName = categoryName({
                          name: category.categoryName,
                          name_zh: category.categoryNameZh,
                        })
                        const tone = getStatusTone(category.status)

                        return (
                          <BudgetCategoryRow
                            key={category.categoryId}
                            cat={category}
                            isEditing={editingId === category.categoryId}
                            editValue={editValue}
                            saving={saving}
                            tone={tone}
                            hasBudget={Boolean(hasBudget)}
                            displayCategoryName={displayCategoryName}
                            currencyCode={summary.currencyCode}
                            onStartEdit={() => startEdit(category)}
                            onEditChange={(v) => setEditValue(v)}
                            onEditKeyDown={(e) => handleEditKeyDown(e, category.categoryId)}
                            onCommit={() => commitEdit(category.categoryId)}
                            onCancelEdit={cancelEdit}
                            onOpenDetails={() => openCategoryDetail(category.categoryId)}
                            onAmountAria={t('budgets.amountAria')}
                            t={t}
                          />
                        )
                      })}
                  </div>
                )}
              </Card>
            )
          })}
          <Drawer
            open={Boolean(selectedCategory)}
            title={selectedCategory ? categoryName({
              name: selectedCategory.categoryName,
              name_zh: selectedCategory.categoryNameZh,
            }) : t('common.details')}
            onClose={() => setSelectedCategoryId(null)}
            className="budget-detail-panel"
          >
            {selectedCategory && (
              <BudgetCategoryDetail
                category={selectedCategory}
                currencyCode={summary.currencyCode}
                categoryHref={buildCategoryLink(
                  selectedCategory.categoryId,
                  selectedCategory.categoryName
                )}
                displayCategoryName={categoryName({
                  name: selectedCategory.categoryName,
                  name_zh: selectedCategory.categoryNameZh,
                })}
                t={t}
              />
            )}
          </Drawer>
        </>
      )}
    </div>
  )
}

type BudgetCategoryRowProps = {
  cat: CategoryBudgetSummary
  isEditing: boolean
  editValue: string
  saving: boolean
  tone: ReturnType<typeof getStatusTone>
  hasBudget: boolean
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onCommit: () => void
  onCancelEdit: () => void
  onOpenDetails: () => void
  onAmountAria: string
  displayCategoryName: string
  currencyCode: string
  t: (key: string, params?: Record<string, string | number>) => string
}

function BudgetCategoryRow({
  cat,
  isEditing,
  editValue,
  saving,
  tone,
  hasBudget,
  onStartEdit,
  onEditChange,
  onEditKeyDown,
  onCommit,
  onCancelEdit,
  onOpenDetails,
  onAmountAria,
  displayCategoryName,
  currencyCode,
  t,
}: BudgetCategoryRowProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const showRemaining = hasBudget && cat.baseBudget > 0

  return (
    <div className="budget-risk-row budget-category-row">
      <div className="budget-category-main">
        <button
          type="button"
          className="budget-category-button"
          onClick={onOpenDetails}
        >
          {displayCategoryName}
        </button>
        <span>
          {t('budgets.spentOf', {
            spent: formatCurrency(cat.actualSpend, currencyCode),
            budget: formatCurrency(cat.baseBudget, currencyCode),
          })}
        </span>
        {cat.baseBudget > 0 && cat.remaining < 0 && (
          <span className="budget-note" style={{ display: 'block' }}>
            {t('budgets.overBy', { amount: formatCurrency(Math.abs(cat.remaining), currencyCode) })}
          </span>
        )}
      </div>
      <div className="budget-category-edit-cell">
        {isEditing ? (
          <div>
            <EditInput
              ref={inputRef}
              value={editValue}
              disabled={saving}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={onEditKeyDown}
              ariaLabel={onAmountAria}
            />
            <div className="budget-edit-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={saving}
                onClick={onCommit}
              >
                {saving ? t('common.saving') : t('budgets.saveBudget')}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={saving}
                onClick={onCancelEdit}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="budget-edit-button"
            type="button"
            onClick={onStartEdit}
            aria-label={t('budgets.editBudgetAria', { category: displayCategoryName })}
          >
            {cat.baseBudget > 0
              ? formatCurrency(cat.baseBudget, currencyCode)
              : t('budgets.setBudget')}
          </button>
        )}
      </div>
      <div className="budget-category-progress-cell">
        <Badge tone={tone}>
          {showRemaining
            ? t('dashboard.left', { amount: formatCurrency(cat.remaining, currencyCode) })
            : t('budgets.notConfigured')}
        </Badge>
        <div style={{ marginTop: '0.45rem' }}>
          <ProgressBar
            value={cat.percentUsed}
            tone={tone}
            label={t('budgets.categoryProgress', { category: displayCategoryName })}
          />
        </div>
      </div>
    </div>
  )
}

const EditInput = forwardRef<
  HTMLInputElement,
  {
    value: string
    disabled: boolean
    onChange: React.ChangeEventHandler<HTMLInputElement>
    onKeyDown: React.KeyboardEventHandler<HTMLInputElement>
    ariaLabel: string
  }
>(function EditInput({ value, disabled, onChange, onKeyDown, ariaLabel }, ref) {
  return (
    <input
      ref={ref}
      type="number"
      min="0"
      step="0.01"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={onChange}
      onKeyDown={onKeyDown}
      className="input budget-edit-input"
    />
  )
})

function BudgetCategoryDetail({
  category,
  currencyCode,
  categoryHref,
  displayCategoryName,
  t,
}: {
  category: CategoryBudgetSummary
  currencyCode: string
  categoryHref: string
  displayCategoryName: string
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const tone = getStatusTone(category.status)

  return (
    <div className="budget-detail-content">
      <div className="budget-detail-hero">
        <Badge tone={tone}>{category.status.replace('_', ' ')}</Badge>
        <strong>
          {category.percentUsed === null
            ? t('budgets.notConfigured')
            : t('budgets.used', { percent: Math.round(category.percentUsed * 100) })}
        </strong>
        <ProgressBar
          value={category.percentUsed}
          tone={tone}
          label={t('budgets.categoryProgress', { category: displayCategoryName })}
        />
      </div>
      <div className="budget-detail-metrics">
        <div>
          <span className="metric-label">{t('budgets.budget')}</span>
          <span className="metric-value">
            {formatCurrency(category.baseBudget, currencyCode)}
          </span>
        </div>
        <div>
          <span className="metric-label">{t('budgets.spent')}</span>
          <span className="metric-value">
            {formatCurrency(category.actualSpend, currencyCode)}
          </span>
        </div>
        <div>
          <span className="metric-label">{t('budgets.left')}</span>
          <span
            className="metric-value"
            style={{ color: category.remaining < 0 ? 'var(--expense)' : 'var(--income)' }}
          >
            {formatCurrency(category.remaining, currencyCode)}
          </span>
        </div>
      </div>
      <div className="drawer-section">
        <h3>{t('budgets.nextAction')}</h3>
        <p className="drawer-copy">
          {category.remaining < 0
            ? t('budgets.detailOverCopy', {
                amount: formatCurrency(Math.abs(category.remaining), currencyCode),
              })
            : category.baseBudget <= 0
              ? t('budgets.detailNoBudgetCopy')
              : t('budgets.detailSafeCopy')}
        </p>
        <Link className="btn btn-primary btn-md" href={categoryHref}>
          {t('review.openTransactions')}
        </Link>
      </div>
    </div>
  )
}
