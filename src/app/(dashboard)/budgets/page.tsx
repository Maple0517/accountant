'use client'

import Link from 'next/link'
import { forwardRef, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
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
      cancelEdit()
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

  const visibleCategories = summary?.categories ?? []
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

          {sectionOrder.map((group) => {
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
                        const categoryHref = buildCategoryLink(category.categoryId, category.categoryName)
                        const tone = getStatusTone(category.status)

                        return (
                          <div
                            key={category.categoryId}
                            className="budget-risk-row"
                          >
                            <div>
                              <strong>
                                <Link className="subtle-link" href={categoryHref}>
                                  {displayCategoryName}
                                </Link>
                              </strong>
                              <span style={{ display: 'block' }}>
                                {t('budgets.spentOf', {
                                  spent: formatCurrency(category.actualSpend, summary.currencyCode),
                                  budget: formatCurrency(category.baseBudget, summary.currencyCode),
                                })}
                              </span>
                              <span className="budget-note" style={{ display: 'block' }}>
                                <Link className="subtle-link" href={categoryHref}>
                                  {t('review.openTransactions')}
                                </Link>
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                              <Badge tone={tone}>{category.status.replace('_', ' ')}</Badge>
                              <span className="badge badge-muted">
                                {hasBudget && category.baseBudget > 0
                                  ? formatCurrency(category.baseBudget, summary.currencyCode)
                                  : t('budgets.notConfigured')}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )}
              </Card>
            )
          })}

          {visibleCategories.length === 0 ? (
            <EmptyState
              title={t('budgets.noCategoriesTitle')}
            >
              {t('budgets.noCategoriesCopy', { month: monthlyLabel })}
            </EmptyState>
          ) : (
            <Card className="budget-table" padding="none">
              <div className="budget-row budget-row-heading" aria-hidden="true">
                <span>{t('budgets.category')}</span>
                <span>{t('budgets.budget')}</span>
                <span>{t('budgets.spent')}</span>
                <span>{t('budgets.left')}</span>
                <span>{t('budgets.progress')}</span>
                <span>{t('budgets.status')}</span>
              </div>
              {visibleCategories.map((cat) => (
                <CategoryRow
                  key={cat.categoryId}
                  cat={cat}
                  isEditing={editingId === cat.categoryId}
                  editValue={editValue}
                  saving={saving}
                  onStartEdit={() => startEdit(cat)}
                  onEditChange={(v) => setEditValue(v)}
                  onEditKeyDown={(e) => handleEditKeyDown(e, cat.categoryId)}
                  onCommit={() => commitEdit(cat.categoryId)}
                  onAmountAria={t('budgets.amountAria')}
                  displayCategoryName={categoryName({
                    name: cat.categoryName,
                    name_zh: cat.categoryNameZh,
                  })}
                  editActionLabel={locale === 'zh' ? '编辑预算' : 'Edit budget'}
                  categoryHref={buildCategoryLink(cat.categoryId, cat.categoryName)}
                  currencyCode={summary.currencyCode}
                  t={t}
                />
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  )
}

type CategoryRowProps = {
  cat: CategoryBudgetSummary
  isEditing: boolean
  editValue: string
  saving: boolean
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onCommit: () => void
  onAmountAria: string
  displayCategoryName: string
  editActionLabel: string
  categoryHref: string
  currencyCode: string
  t: (key: string, params?: Record<string, string | number>) => string
}

function CategoryRow({
  cat,
  isEditing,
  editValue,
  saving,
  onStartEdit,
  onEditChange,
  onEditKeyDown,
  onCommit,
  onAmountAria,
  displayCategoryName,
  editActionLabel,
  categoryHref,
  currencyCode,
  t,
}: CategoryRowProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const tone = getStatusTone(cat.status)
  const remainingColor = cat.remaining < 0 ? 'var(--expense)' : 'var(--text-primary)'

  return (
    <div className="budget-row">
      <div>
        <span className="budget-category-name">{displayCategoryName}</span>
        <span className="budget-note" style={{ display: 'block' }}>
          <Link className="subtle-link" href={categoryHref}>
            {t('review.openTransactions')}
          </Link>
        </span>
        {cat.remaining < 0 && (
          <span className="budget-note" style={{ display: 'block' }}>
            {t('budgets.overBy', { amount: formatCurrency(Math.abs(cat.remaining), currencyCode) })}
          </span>
        )}
      </div>
      <div>
        <span className="budget-cell-label">{t('budgets.budget')}</span>
        {isEditing ? (
          <EditInput
            ref={inputRef}
            value={editValue}
            disabled={saving}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={onEditKeyDown}
            onBlur={onCommit}
            ariaLabel={onAmountAria}
          />
        ) : (
          <button
            className="budget-edit-button"
            type="button"
            onClick={onStartEdit}
            aria-label={t('budgets.editBudgetAria', { category: displayCategoryName })}
          >
            <span className="budget-note" style={{ display: 'block' }}>{editActionLabel}</span>
            {formatCurrency(cat.baseBudget, currencyCode)}
          </button>
        )}
      </div>
      <div>
        <span className="budget-cell-label">{t('budgets.spent')}</span>
        <span className="budget-cell-value">{formatCurrency(cat.actualSpend, currencyCode)}</span>
      </div>
      <div>
        <span className="budget-cell-label">{t('budgets.left')}</span>
        <span className="budget-cell-value" style={{ color: remainingColor }}>
          {formatCurrency(cat.remaining, currencyCode)}
        </span>
      </div>
      <div className="budget-progress-cell">
        <span className="budget-cell-label">{t('budgets.progress')}</span>
        <div style={{ marginTop: '0.45rem' }}>
          <ProgressBar
            value={cat.percentUsed}
            tone={tone}
            label={t('budgets.categoryProgress', { category: displayCategoryName })}
          />
        </div>
      </div>
      <div className="budget-actions-cell">
        <Badge tone={tone}>{cat.status.replace('_', ' ')}</Badge>
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
    onBlur: React.FocusEventHandler<HTMLInputElement>
    ariaLabel: string
  }
>(function EditInput({ value, disabled, onChange, onKeyDown, onBlur, ariaLabel }, ref) {
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
      onBlur={onBlur}
      className="input budget-edit-input"
    />
  )
})
