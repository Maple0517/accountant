'use client'

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

function formatMonthLabel(monthParam: string): string {
  const [year, month] = monthParam.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
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
    return { label: 'Not configured', tone: 'neutral' as const, copy: 'Set budgets to unlock monthly guidance.' }
  }
  if (summary.totalActualSpend > summary.totalBaseBudget) {
    return { label: 'Over', tone: 'danger' as const, copy: 'Spending has exceeded the monthly plan.' }
  }
  if (summary.totalPercentUsed >= 0.8) {
    return { label: 'Watch', tone: 'warning' as const, copy: 'You are close to the monthly limit.' }
  }
  return { label: 'Safe', tone: 'success' as const, copy: 'Current spending is inside the monthly plan.' }
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Failed to load budget data (${res.status})`)
  return json as MonthlyBudgetSummary
}

export default function BudgetsPage() {
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
      setSaveError('Budget amount must be a non-negative number.')
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
      const message = err instanceof Error ? err.message : 'Failed to update budget'
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
  const riskyCategories = visibleCategories
    .filter((category) => category.status === 'near' || category.status === 'over')
    .sort((a, b) => (b.percentUsed ?? 0) - (a.percentUsed ?? 0))
    .slice(0, 4)

  return (
    <div className="budgets-page">
      <PageHeader
        title="Budgets"
        subtitle="See which categories are safe, close, or over for the selected month."
        actions={
          <div className="page-header-actions">
            <Button variant="ghost" size="sm" onClick={handlePrevMonth} aria-label="Previous month">‹</Button>
            <span className="topbar-status">{formatMonthLabel(month)}</span>
            <Button variant="ghost" size="sm" onClick={handleNextMonth} aria-label="Next month">›</Button>
          </div>
        }
      />

      {loading && <div className="skeleton-card" />}
      {!loading && error && <div className="alert alert-error">{error}</div>}
      {!loading && !error && saveError && <div className="alert alert-error">{saveError}</div>}

      {!loading && !error && summary && (
        <>
          <Card className="budget-health-card" padding="lg">
            <div className="budget-health-status">
              <Badge tone={health.tone}>{health.label}</Badge>
              <strong>{summary.totalPercentUsed === null ? 'No plan yet' : `${Math.round(summary.totalPercentUsed * 100)}% used`}</strong>
              <p className="text-secondary">{health.copy}</p>
            </div>
            <div>
              <div className="summary-grid" style={{ marginBottom: '1rem' }}>
                <div><span className="metric-label">Total budget</span><span className="metric-value" style={{ display: 'block' }}>{formatCurrency(summary.totalBaseBudget)}</span></div>
                <div><span className="metric-label">Spent</span><span className="metric-value" style={{ display: 'block' }}>{formatCurrency(summary.totalActualSpend)}</span></div>
                <div><span className="metric-label">Remaining</span><span className="metric-value" style={{ display: 'block', color: summary.totalRemaining < 0 ? 'var(--expense)' : 'var(--income)' }}>{formatCurrency(summary.totalRemaining)}</span></div>
              </div>
              <ProgressBar value={summary.totalPercentUsed} tone={health.tone} label="Monthly budget progress" />
              {summary.totalRemaining < 0 && <p className="budget-note">Remaining is negative because posted budget-counting spending is above the configured budget.</p>}
            </div>
          </Card>

          {riskyCategories.length > 0 && (
            <Card padding="md">
              <div className="card-header" style={{ padding: 0, border: 0, marginBottom: '0.8rem' }}>
                <div>
                  <h3>Categories to watch</h3>
                  <p className="card-subtitle">The categories closest to their monthly limit.</p>
                </div>
              </div>
              <div className="budget-risk-list">
                {riskyCategories.map((category) => (
                  <div className="budget-risk-row" key={category.categoryId}>
                    <div>
                      <strong>{category.categoryName}</strong>
                      <span style={{ display: 'block' }}>{formatCurrency(category.actualSpend)} spent of {formatCurrency(category.baseBudget)}</span>
                    </div>
                    <Badge tone={getStatusTone(category.status)}>{category.status.replace('_', ' ')}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {visibleCategories.length === 0 ? (
            <EmptyState title="No budgetable categories yet">Add an expense category first, then return here to set a spending limit for {formatMonthLabel(month)}.</EmptyState>
          ) : (
            <Card className="budget-table" padding="none">
              <div className="budget-row budget-row-heading" aria-hidden="true">
                <span>Category</span>
                <span>Budget</span>
                <span>Spent</span>
                <span>Left</span>
                <span>Progress</span>
                <span>Status</span>
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
        <span className="budget-category-name">{cat.categoryName}</span>
        {cat.remaining < 0 && <span className="budget-note" style={{ display: 'block' }}>Over by {formatCurrency(Math.abs(cat.remaining))}</span>}
      </div>
      <div>
        <span className="budget-cell-label">Budget</span>
        {isEditing ? (
          <EditInput
            ref={inputRef}
            value={editValue}
            disabled={saving}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={onEditKeyDown}
            onBlur={onCommit}
          />
        ) : (
          <button className="budget-edit-button" type="button" onClick={onStartEdit} aria-label={`Edit monthly budget for ${cat.categoryName}`}>
            {formatCurrency(cat.baseBudget)}
          </button>
        )}
      </div>
      <div><span className="budget-cell-label">Spent</span><span className="budget-cell-value">{formatCurrency(cat.actualSpend)}</span></div>
      <div><span className="budget-cell-label">Left</span><span className="budget-cell-value" style={{ color: remainingColor }}>{formatCurrency(cat.remaining)}</span></div>
      <div className="budget-progress-cell">
        <span className="budget-cell-label">Progress</span>
        <div style={{ marginTop: '0.45rem' }}><ProgressBar value={cat.percentUsed} tone={tone} label={`${cat.categoryName} budget progress`} /></div>
      </div>
      <div className="budget-actions-cell"><Badge tone={tone}>{cat.status.replace('_', ' ')}</Badge></div>
    </div>
  )
}

const EditInput = forwardRef<HTMLInputElement, {
  value: string
  disabled: boolean
  onChange: React.ChangeEventHandler<HTMLInputElement>
  onKeyDown: React.KeyboardEventHandler<HTMLInputElement>
  onBlur: React.FocusEventHandler<HTMLInputElement>
}>(function EditInput({ value, disabled, onChange, onKeyDown, onBlur }, ref) {
  return (
    <input
      ref={ref}
      type="number"
      min="0"
      step="0.01"
      value={value}
      disabled={disabled}
      aria-label="Budget amount"
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className="input budget-edit-input"
    />
  )
})
