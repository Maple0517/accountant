'use client'

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { formatCurrency } from '@/lib/currency'
import type { CategoryBudgetSummary, MonthlyBudgetSummary } from '@/modules/budget/budget.types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function toMonthParam(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function formatMonthLabel(monthParam: string): string {
  // monthParam: "YYYY-MM"
  const [year, month] = monthParam.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function addMonths(monthParam: string, delta: number): string {
  const [year, month] = monthParam.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return toMonthParam(date)
}

const STATUS_COLORS: Record<CategoryBudgetSummary['status'], string> = {
  under: '#22c55e',
  near: '#f59e0b',
  over: '#ef4444',
  no_budget: '#6b7280',
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function BudgetsPage() {
  const [month, setMonth] = useState<string>(() => toMonthParam(new Date()))
  const [summary, setSummary] = useState<MonthlyBudgetSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const fetchSummary = useCallback(async (targetMonth: string) => {
    setLoading(true)
    setError(null)
    setSaveError(null)
    try {
      const res = await fetch(`/api/budget/monthly-summary?month=${targetMonth}`)
      if (!res.ok) {
        throw new Error(`Failed to load budget data (${res.status})`)
      }
      const data: MonthlyBudgetSummary = await res.json()
      setSummary(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSummary(month)
  }, [month, fetchSummary])

  // ── Month navigation ───────────────────────────────────────────────────────

  function handlePrevMonth() {
    setMonth((m) => addMonths(m, -1))
  }

  function handleNextMonth() {
    setMonth((m) => addMonths(m, 1))
  }

  // ── Inline editing ─────────────────────────────────────────────────────────

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
        let message = `Save failed (${res.status})`
        try {
          const payload = (await res.json()) as { error?: string }
          if (payload?.error) {
            message = payload.error
          }
        } catch {
          // Ignore response parsing issues and keep fallback message.
        }
        throw new Error(message)
      }

      setEditingId(null)
      setEditValue('')
      await fetchSummary(month)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update budget'
      setSaveError(message)
      console.error('Failed to update budget:', err)
    } finally {
      setSaving(false)
    }
  }

  function handleEditKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    categoryId: string
  ) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitEdit(categoryId)
    } else if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const visibleCategories =
    summary?.categories.filter(
      (c) => c.baseBudget > 0 || c.actualSpend > 0
    ) ?? []

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="budgets-page">
      {/* Page header */}
      <div className="page-header">
        <h1>Budgets</h1>
        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            id="budget-prev-month"
            className="btn btn-ghost"
            onClick={handlePrevMonth}
            style={{ padding: '0.5rem 0.875rem', fontSize: '1rem' }}
            aria-label="Previous month"
          >
            ‹
          </button>
          <span
            style={{
              fontWeight: 600,
              fontSize: '1rem',
              minWidth: '130px',
              textAlign: 'center',
            }}
          >
            {formatMonthLabel(month)}
          </span>
          <button
            id="budget-next-month"
            className="btn btn-ghost"
            onClick={handleNextMonth}
            style={{ padding: '0.5rem 0.875rem', fontSize: '1rem' }}
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="loading-state animate-fade-in">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card skeleton-card" style={{ height: '80px' }} />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="card alert alert-error" style={{ padding: '1.5rem' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Save error */}
      {!loading && !error && saveError && (
        <div className="card alert alert-error" style={{ padding: '1rem 1.5rem' }}>
          ⚠️ {saveError}
        </div>
      )}

      {/* Content */}
      {!loading && !error && summary && (
        <div className="animate-slide-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Summary cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
            }}
          >
            <SummaryCard
              label="Total Budget"
              value={formatCurrency(summary.totalBaseBudget)}
            />
            <SummaryCard
              label="Total Spent"
              value={formatCurrency(summary.totalActualSpend)}
              accent="var(--accent-orange)"
            />
            <SummaryCard
              label="Remaining"
              value={formatCurrency(summary.totalRemaining)}
              accent={summary.totalRemaining < 0 ? 'var(--accent-red)' : 'var(--accent-green)'}
            />
          </div>

          {/* Category list */}
          {visibleCategories.length === 0 ? (
            <div className="card empty-state">
              <span className="empty-icon">🎯</span>
              <h3>No budgets set up yet</h3>
              <p className="text-secondary">
                Click any category&apos;s budget amount below to set a spending limit for{' '}
                {formatMonthLabel(month)}.
              </p>
            </div>
          ) : (
            <div
              className="card"
              style={{ padding: '0', overflow: 'hidden' }}
            >
              {/* Card header */}
              <div
                style={{
                  padding: '1rem 1.5rem',
                  borderBottom: '1px solid var(--glass-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '1rem' }}>
                  Category Budgets
                </span>
                <span className="text-secondary" style={{ fontSize: '0.8rem' }}>
                  {visibleCategories.length} categor{visibleCategories.length !== 1 ? 'ies' : 'y'}
                </span>
              </div>

              {/* Category rows */}
              <div style={{ padding: '0.5rem 0' }}>
                {visibleCategories.map((cat, idx) => (
                  <CategoryRow
                    key={cat.categoryId}
                    cat={cat}
                    isEditing={editingId === cat.categoryId}
                    editValue={editValue}
                    saving={saving}
                    isLast={idx === visibleCategories.length - 1}
                    onStartEdit={() => startEdit(cat)}
                    onEditChange={(v) => setEditValue(v)}
                    onEditKeyDown={(e) => handleEditKeyDown(e, cat.categoryId)}
                    onCommit={() => commitEdit(cat.categoryId)}
                    onCancel={cancelEdit}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── SummaryCard ──────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div className="card stat-card">
      <span className="stat-label">{label}</span>
      <span
        className="stat-value"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
    </div>
  )
}

// ── CategoryRow ──────────────────────────────────────────────────────────────

type CategoryRowProps = {
  cat: CategoryBudgetSummary
  isEditing: boolean
  editValue: string
  saving: boolean
  isLast: boolean
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onCommit: () => void
  onCancel: () => void
}

function CategoryRow({
  cat,
  isEditing,
  editValue,
  saving,
  isLast,
  onStartEdit,
  onEditChange,
  onEditKeyDown,
  onCommit,
  onCancel,
}: CategoryRowProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const barWidth = `${Math.min((cat.percentUsed ?? 0) * 100, 100)}%`
  const barColor = STATUS_COLORS[cat.status]
  const isNegativeRemaining = cat.remaining < 0

  return (
    <div
      style={{
        padding: '1rem 1.5rem',
        borderBottom: isLast ? 'none' : '1px solid var(--glass-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
        transition: 'background var(--transition-fast)',
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLDivElement).style.background =
          'var(--bg-card-hover)')
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLDivElement).style.background = 'transparent')
      }
    >
      {/* Row top: name + budget amount + spent + remaining */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        {/* Category name */}
        <span
          style={{
            flex: '1 1 140px',
            fontWeight: 500,
            fontSize: '0.95rem',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {cat.categoryName}
        </span>

        {/* Budget amount (editable) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Budget
          </span>
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
            <button
              id={`budget-edit-${cat.categoryId}`}
              onClick={onStartEdit}
              title="Click to edit budget"
              style={{
                background: 'rgba(108, 92, 231, 0.1)',
                border: '1px solid rgba(108, 92, 231, 0.25)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.875rem',
                fontWeight: 600,
                padding: '0.25rem 0.6rem',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background =
                  'rgba(108, 92, 231, 0.2)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor =
                  'rgba(108, 92, 231, 0.5)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background =
                  'rgba(108, 92, 231, 0.1)'
                ;(e.currentTarget as HTMLButtonElement).style.borderColor =
                  'rgba(108, 92, 231, 0.25)'
              }}
            >
              {formatCurrency(cat.baseBudget)}
            </button>
          )}
        </div>

        {/* Spent */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Spent
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            {formatCurrency(cat.actualSpend)}
          </span>
        </div>

        {/* Remaining */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Left
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: isNegativeRemaining ? '#ef4444' : 'var(--text-primary)',
            }}
          >
            {formatCurrency(cat.remaining)}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.08)',
          borderRadius: '9999px',
          overflow: 'hidden',
          height: '8px',
        }}
      >
        <div
          style={{
            width: barWidth,
            backgroundColor: barColor,
            height: '8px',
            borderRadius: 'inherit',
            transition: 'width 0.3s',
          }}
        />
      </div>
    </div>
  )
}

// ── EditInput ────────────────────────────────────────────────────────────────

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
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      style={{
        width: '110px',
        padding: '0.25rem 0.5rem',
        background: 'rgba(0,0,0,0.3)',
        border: '1px solid var(--accent-primary)',
        borderRadius: '8px',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.875rem',
        outline: 'none',
        boxShadow: '0 0 0 3px rgba(108, 92, 231, 0.2)',
      }}
    />
  )
})
