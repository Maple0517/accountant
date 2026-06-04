'use client'

import { useEffect, useState } from 'react'
import { formatCurrency } from '@/lib/currency'
import {
  deriveTransactionTreatment,
  normalizeTransactionSemantics,
} from '@/lib/transactions/treatment'
import type {
  Category,
  RefundSource,
  Transaction,
  TransactionSplitGroup,
  TransactionTreatment,
} from '@/types'

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
  categories?: Pick<
    Category,
    'id' | 'name' | 'name_zh' | 'icon' | 'color' | 'is_excluded_from_budget'
  > | null
  accounts?: TransactionAccountRelation | null
}

type SplitLineDraft = {
  id?: string
  amount_decimal: string
  category_id: string
  allocation_date: string
  treatment: TransactionTreatment
  refund_source: RefundSource | ''
  linked_transaction_id: string
  merchant_name: string
  description: string
  notes: string
}

type SplitTreatmentPreset = {
  id: string
  labelKey: string
  hintKey: string
  treatment: TransactionTreatment
  refund_source?: RefundSource
}

type SplitPreviewResponse = {
  balanced: boolean
  parentAmountDecimal: string
  childAmountSumDecimal: string
  remainingAmountDecimal: string
  budgetImpactByMonth: Array<{
    month: string
    netSpendingDeltaDecimal: string
    incomeDeltaDecimal: string
  }>
  warnings: string[]
}

type SplitStateResponse = {
  parent: TransactionWithRelations
  group: TransactionSplitGroup | null
  children: TransactionWithRelations[]
  canSplit: boolean
  issues: string[]
  notionSchemaReady?: boolean
  notionSchemaStatus?: 'disabled' | 'ready' | 'not_configured' | 'schema_update_failed'
  warnings?: string[]
  error?: string
  code?: string
}

function decimalPlaces(value: number) {
  return Math.abs(value % 1) > 0 ? 2 : 0
}

function toSplitDecimal(value: number) {
  return value.toFixed(decimalPlaces(value)).replace(/\.?0+$/, '')
}

function splitDecimalToMinor(value: string) {
  const normalized = value.trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return 0
  return Math.round(parsed * 10000)
}

function splitMinorToDecimal(value: number) {
  return (value / 10000).toFixed(4).replace(/\.?0+$/, '')
}

function addSplitDecimals(left: string, right: string) {
  return splitMinorToDecimal(splitDecimalToMinor(left) + splitDecimalToMinor(right))
}

function isZeroSplitDecimal(value: string) {
  return splitDecimalToMinor(value) === 0
}

function toDisplayedTransactionAmount(amount: number | string) {
  return -Number(amount)
}

function toDisplayedSplitDecimal(amount: number | string) {
  return toSplitDecimal(toDisplayedTransactionAmount(amount))
}

function toStoredSplitDecimal(amountDecimal: string) {
  return splitMinorToDecimal(-splitDecimalToMinor(amountDecimal))
}

function isDisplayedCreditAmount(amount: number | string) {
  return Number(amount) < 0
}

function isIncomingSplitAmount(amount: number | string) {
  return Number(amount) > 0
}

function getTxTreatment(tx: Pick<Transaction, 'treatment'>) {
  return deriveTransactionTreatment({
    treatment: tx.treatment,
  })
}

function splitAmountEvenly(amount: number, count: number) {
  const cents = Math.round(amount * 100)
  const base = Math.trunc(cents / count)
  let remainder = cents - base * count

  return Array.from({ length: count }, () => {
    let centsForLine = base
    if (remainder !== 0) {
      centsForLine += remainder > 0 ? 1 : -1
      remainder += remainder > 0 ? -1 : 1
    }
    return toSplitDecimal(centsForLine / 100)
  })
}

function getDefaultSplitSemantics(tx: TransactionWithRelations) {
  const hasExplicitTreatment =
    tx.semantic_override_source === 'user' ||
    tx.semantic_override_source === 'rule' ||
    getTxTreatment(tx) !== 'spending'

  if (hasExplicitTreatment) {
    return normalizeTransactionSemantics({
      treatment: tx.treatment,
      refundSource: tx.refund_source,
      amount: Number(tx.amount),
    })
  }

  return normalizeTransactionSemantics({
    treatment: isDisplayedCreditAmount(tx.amount) ? 'income' : 'spending',
  })
}

function addMonths(dateStr: string, offset: number) {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setMonth(date.getMonth() + offset)
  return date.toISOString().slice(0, 10)
}

function createSplitLineDraft(
  tx: TransactionWithRelations,
  amountDecimal: string,
  index: number,
  allocationDate = tx.effective_date || tx.budget_effective_date || tx.date
): SplitLineDraft {
  const defaultSemantics = getDefaultSplitSemantics(tx)

  return normalizeSplitLineForAmount({
    amount_decimal: amountDecimal,
    category_id: tx.category_id || '',
    allocation_date: allocationDate,
    treatment: defaultSemantics.treatment,
    refund_source: (defaultSemantics.refundSource ?? '') as RefundSource | '',
    linked_transaction_id: tx.linked_transaction_id || '',
    merchant_name: tx.merchant_name || '',
    description: index === 0 ? tx.description || '' : '',
    notes: '',
  }, toDisplayedTransactionAmount(tx.amount))
}

function buildInitialSplitLines(
  tx: TransactionWithRelations,
  existingChildren?: TransactionWithRelations[]
) {
  if (existingChildren && existingChildren.length > 0) {
    return existingChildren.map((child) => {
      const defaultSemantics = getDefaultSplitSemantics(child)

      return normalizeSplitLineForAmount({
        id: child.id,
        amount_decimal: toDisplayedSplitDecimal(child.amount),
        category_id: child.category_id || '',
        allocation_date: child.effective_date || child.budget_effective_date || child.date,
        treatment: defaultSemantics.treatment,
        refund_source: (defaultSemantics.refundSource ?? '') as RefundSource | '',
        linked_transaction_id: child.linked_transaction_id || '',
        merchant_name: child.merchant_name || '',
        description: child.description || '',
        notes: child.notes || '',
      }, toDisplayedTransactionAmount(tx.amount))
    })
  }

  return splitAmountEvenly(toDisplayedTransactionAmount(tx.amount), 2).map((amount, index) =>
    createSplitLineDraft(tx, amount, index)
  )
}

function getSplitTreatmentPresetId(line: SplitLineDraft) {
  const exactMatch = SPLIT_TREATMENT_PRESETS.find(
    (preset) =>
      preset.treatment === line.treatment &&
      (preset.refund_source || '') === line.refund_source
  )
  if (exactMatch) return exactMatch.id
  if (line.treatment === 'refund' && line.refund_source === 'reimbursement') return 'reimbursement'
  if (line.treatment === 'refund') return 'refund'
  if (line.treatment === 'transfer') return 'transfer'
  if (line.treatment === 'income') return 'income'
  if (line.treatment === 'excluded') return 'exclude'
  return 'spending'
}

function getSplitTreatmentPresetById(id: string) {
  return SPLIT_TREATMENT_PRESETS.find((preset) => preset.id === id)
}

function getSplitTreatmentPresetsForLine(
  line: SplitLineDraft,
  parentAmount: number
) {
  const referenceAmount = isZeroSplitDecimal(line.amount_decimal)
    ? parentAmount
    : Number(line.amount_decimal)
  const presetOrder = isIncomingSplitAmount(referenceAmount)
    ? ['refund', 'reimbursement', 'income', 'transfer', 'exclude']
    : ['spending', 'transfer', 'exclude']

  return presetOrder
    .map((id) => getSplitTreatmentPresetById(id))
    .filter((preset): preset is SplitTreatmentPreset => Boolean(preset))
}

function applySplitTreatmentPreset(
  line: SplitLineDraft,
  preset: SplitTreatmentPreset
): SplitLineDraft {
  return {
    ...line,
    treatment: preset.treatment,
    refund_source: preset.refund_source || '',
  }
}

function normalizeSplitLineForAmount(
  line: SplitLineDraft,
  parentAmount: number
): SplitLineDraft {
  const allowedPresets = getSplitTreatmentPresetsForLine(line, parentAmount)
  const currentPresetId = getSplitTreatmentPresetId(line)

  if (allowedPresets.some((preset) => preset.id === currentPresetId)) {
    return line
  }

  const fallbackPreset = allowedPresets[0] || getSplitTreatmentPresetById('spending')
  return fallbackPreset ? applySplitTreatmentPreset(line, fallbackPreset) : line
}

function buildSplitPayload(lines: SplitLineDraft[], expectedVersion?: number | null) {
  return {
    expected_version: expectedVersion ?? null,
    children: lines.map((line) => ({
      id: line.id,
      amount_decimal: toStoredSplitDecimal(line.amount_decimal),
      category_id: line.category_id || null,
      allocation_date: line.allocation_date || null,
      treatment: line.treatment,
      refund_source: line.refund_source || null,
      linked_transaction_id: line.linked_transaction_id || null,
      merchant_name: line.merchant_name || null,
      description: line.description || null,
      notes: line.notes || null,
    })),
  }
}

const SPLIT_TREATMENT_PRESETS: SplitTreatmentPreset[] = [
  {
    id: 'spending',
    labelKey: 'transactions.spendingOption',
    hintKey: 'transactions.spendingOptionHint',
    treatment: 'spending',
  },
  {
    id: 'income',
    labelKey: 'transactions.incomeOption',
    hintKey: 'transactions.incomeOptionHint',
    treatment: 'income',
  },
  {
    id: 'transfer',
    labelKey: 'transactions.internalTransfer',
    hintKey: 'transactions.internalTransferHint',
    treatment: 'transfer',
  },
  {
    id: 'refund',
    labelKey: 'common.refund',
    hintKey: 'transactions.refundOptionHint',
    treatment: 'refund',
    refund_source: 'merchant_refund',
  },
  {
    id: 'reimbursement',
    labelKey: 'common.reimbursement',
    hintKey: 'transactions.reimbursementOptionHint',
    treatment: 'refund',
    refund_source: 'reimbursement',
  },
  {
    id: 'exclude',
    labelKey: 'transactions.exclude',
    hintKey: 'transactions.excludeOptionHint',
    treatment: 'excluded',
  },
]

export default function SplitEditorDrawer({
  transaction,
  categories,
  categoryName,
  t,
  onClose,
  onSaved,
}: {
  transaction: TransactionWithRelations
  categories: Category[]
  categoryName: (category?: { name?: string | null; name_zh?: string | null } | null, fallback?: string) => string
  t: (key: string, params?: Record<string, string | number>) => string
  onClose: () => void
  onSaved: () => void
}) {
  const [splitState, setSplitState] = useState<SplitStateResponse | null>(null)
  const [lines, setLines] = useState<SplitLineDraft[]>(() =>
    buildInitialSplitLines(transaction)
  )
  const [preview, setPreview] = useState<SplitPreviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const parent = splitState?.parent || transaction
  const currency = parent.iso_currency_code || 'USD'
  const hasExistingSplit = Boolean(splitState?.group && splitState.children.length > 0)
  const notionSchemaBlocked =
    splitState?.notionSchemaReady === false ||
    splitState?.issues?.includes('NOTION_SCHEMA_NOT_READY')
  const remainingIsBalanced = preview ? isZeroSplitDecimal(preview.remainingAmountDecimal) : false

  const getLineCategoryLabel = (line: SplitLineDraft) => {
    if (!line.category_id) return t('common.uncategorized')
    return categoryName(
      categories.find((category) => category.id === line.category_id),
      t('common.uncategorized')
    )
  }

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function loadSplit() {
      setLoading(true)
      setMessage(null)
      try {
        const response = await fetch(`/api/transactions/${transaction.id}/split`, {
          signal: controller.signal,
        })
        const data = (await response.json()) as SplitStateResponse
        if (cancelled) return
        if (!response.ok) {
          throw new Error(data.error || t('transactions.splitLoadError'))
        }
        setSplitState(data)
        setLines(buildInitialSplitLines(data.parent, data.children))
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setMessage(error instanceof Error ? error.message : t('transactions.splitLoadError'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadSplit()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [transaction.id, t])

  useEffect(() => {
    if (loading || parent.pending || notionSchemaBlocked) return
    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/transactions/${parent.id}/split/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildSplitPayload(lines, splitState?.group?.version)),
          signal: controller.signal,
        })
        const data = (await response.json()) as SplitPreviewResponse & { error?: string }
        if (!response.ok) {
          setPreview(null)
          return
        }
        setPreview(data)
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('Failed to preview split:', error)
        }
      }
    }, 250)

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [lines, loading, notionSchemaBlocked, parent.id, parent.pending, splitState?.group?.version])

  const setLine = (index: number, patch: Partial<SplitLineDraft>) => {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? normalizeSplitLineForAmount(
              { ...line, ...patch },
              toDisplayedTransactionAmount(parent.amount)
            )
          : line
      )
    )
  }

  const addLine = () => {
    setLines((current) => [
      ...current,
      createSplitLineDraft(parent, '0', current.length),
    ])
  }

  const removeLine = (index: number) => {
    setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))
  }

  const applyEqualSplit = () => {
    const amounts = splitAmountEvenly(
      toDisplayedTransactionAmount(parent.amount),
      Math.max(lines.length, 2)
    )
    setLines((current) =>
      (current.length >= 2 ? current : buildInitialSplitLines(parent)).map(
        (line, index) => ({ ...line, amount_decimal: amounts[index] || '0' })
      )
    )
  }

  const applyMonthlySpread = () => {
    const startDate = parent.effective_date || parent.budget_effective_date || parent.date
    setLines((current) =>
      current.map((line, index) => ({
        ...line,
        allocation_date: addMonths(startDate, index),
      }))
    )
  }

  const applyRemainingToLine = (index: number) => {
    if (!preview || isZeroSplitDecimal(preview.remainingAmountDecimal)) return
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              amount_decimal: addSplitDecimals(
                line.amount_decimal,
                toDisplayedSplitDecimal(preview.remainingAmountDecimal)
              ),
            }
          : line
      )
    )
  }

  const saveSplit = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/transactions/${parent.id}/split`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSplitPayload(lines, splitState?.group?.version)),
      })
      const data = (await response.json()) as SplitStateResponse
      if (!response.ok) {
        throw new Error(data.error || t('transactions.splitSaveError'))
      }
      onSaved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('transactions.splitSaveError'))
    } finally {
      setSaving(false)
    }
  }

  const restoreSplit = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/transactions/${parent.id}/split`, {
        method: 'DELETE',
      })
      const data = (await response.json()) as SplitStateResponse
      if (!response.ok) {
        throw new Error(data.error || t('transactions.splitRestoreError'))
      }
      onSaved()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('transactions.splitRestoreError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="drawer-backdrop" role="dialog" aria-modal="true">
      <div className="drawer-panel split-editor-panel">
        <div className="drawer-header">
          <div>
            <h2>{t('transactions.splitEditorTitle')}</h2>
            <p className="card-subtitle">
              {parent.merchant_name || parent.description}
            </p>
          </div>
          <button
            type="button"
            className="drawer-close"
            aria-label={t('common.cancel')}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="drawer-content">
          {loading ? (
            <p className="text-secondary">{t('common.loading')}</p>
          ) : parent.pending ? (
            <div className="split-editor-status warning">
              {t('transactions.splitPendingDisabled')}
            </div>
          ) : notionSchemaBlocked ? (
            <div className="split-editor-status warning">
              {t('transactions.splitNotionSchemaNotReady')}
            </div>
          ) : (
            <>
              <div className="split-allocation-overview">
                <div className="split-allocation-metric">
                  <span>{t('transactions.splitOriginalAmount')}</span>
                  <strong>{formatCurrency(-Number(parent.amount), currency)}</strong>
                </div>
                <div className="split-allocation-metric">
                  <span>{t('transactions.splitAllocatedAmount')}</span>
                  <strong>
                    {preview
                      ? formatCurrency(-Number(preview.childAmountSumDecimal), currency)
                      : t('common.loading')}
                  </strong>
                </div>
                <div className={`split-allocation-metric ${remainingIsBalanced ? 'balanced' : 'unbalanced'}`}>
                  <span>{t('transactions.splitRemainingLabel')}</span>
                  <strong>
                    {preview
                      ? formatCurrency(-Number(preview.remainingAmountDecimal), currency)
                      : t('common.loading')}
                  </strong>
                </div>
              </div>
              {parent.split_status === 'out_of_balance' && (
                <div className="split-editor-status warning">
                  {t('transactions.splitOutOfBalance')}
                </div>
              )}
              {message && (
                <div className="split-editor-status danger">{message}</div>
              )}
              <div className="split-editor-toolbar">
                <span className="split-toolbar-label">{t('transactions.splitQuickActions')}</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={applyEqualSplit}>
                  {t('transactions.splitEqual')}
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={applyMonthlySpread}>
                  {t('transactions.splitMonthly')}
                </button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={addLine}>
                  {t('transactions.splitAddLine')}
                </button>
              </div>
              <div className="split-lines">
                {lines.map((line, index) => {
                  const treatmentPresetId = getSplitTreatmentPresetId(line)
                  const treatmentPresets = getSplitTreatmentPresetsForLine(
                    line,
                    toDisplayedTransactionAmount(parent.amount)
                  )
                  return (
                    <div key={`${line.id || 'new'}-${index}`} className="split-line">
                      <div className="split-line-header">
                        <div>
                          <span>{t('transactions.splitAllocation', { index: index + 1 })}</span>
                          <small>{getLineCategoryLabel(line)}</small>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          disabled={lines.length <= 2}
                          onClick={() => removeLine(index)}
                        >
                          {t('transactions.clear')}
                        </button>
                      </div>
                      <div className="split-line-main">
                        <label className="split-field">
                          <span>{t('transactions.splitAmountLabel')}</span>
                          <input
                            className="input"
                            inputMode="decimal"
                            aria-label={t('transactions.splitAmountAria', { index: index + 1 })}
                            value={line.amount_decimal}
                            onChange={(event) => setLine(index, { amount_decimal: event.target.value })}
                          />
                        </label>
                        <label className="split-field">
                          <span>{t('transactions.category')}</span>
                          <select
                            className="input"
                            aria-label={t('transactions.category')}
                            value={line.category_id}
                            onChange={(event) => setLine(index, { category_id: event.target.value })}
                          >
                            <option value="">{t('common.uncategorized')}</option>
                            {categories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.icon || '•'} {categoryName(category)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="split-field">
                          <span>{t('transactions.splitAllocationDate')}</span>
                          <input
                            type="date"
                            className="input"
                            aria-label={t('transactions.splitAllocationDate')}
                            value={line.allocation_date}
                            onChange={(event) => setLine(index, { allocation_date: event.target.value })}
                          />
                        </label>
                      </div>
                      <div className="split-treatment-group" role="group" aria-label={t('transactions.splitTreatment')}>
                        {treatmentPresets.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={`split-treatment-option ${treatmentPresetId === preset.id ? 'selected' : ''}`}
                            onClick={() =>
                              setLine(index, {
                                treatment: preset.treatment,
                                refund_source: preset.refund_source || '',
                              })
                            }
                          >
                            <strong>{t(preset.labelKey)}</strong>
                            <span>{t(preset.hintKey)}</span>
                          </button>
                        ))}
                      </div>
                      <div className="split-line-footer">
                        <input
                          className="input"
                          aria-label={t('transactions.splitNote')}
                          placeholder={t('transactions.splitNote')}
                          value={line.notes}
                          onChange={(event) => setLine(index, { notes: event.target.value })}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          disabled={!preview || remainingIsBalanced}
                          onClick={() => applyRemainingToLine(index)}
                        >
                          {t('transactions.splitFillRemaining')}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {preview && (
                <div className={`split-preview ${preview.balanced ? 'balanced' : 'unbalanced'}`}>
                  <span>
                    {preview.balanced
                      ? t('transactions.splitBalanced')
                      : t('transactions.splitUnbalanced')}
                  </span>
                  {preview.warnings.map((warning) => (
                    <span key={warning}>{warning}</span>
                  ))}
                  {preview.budgetImpactByMonth.map((month) => (
                    <span key={month.month}>
                      {t('transactions.splitBudgetImpact')}: {month.month} · {formatCurrency(-Number(month.netSpendingDeltaDecimal), currency)}
                    </span>
                  ))}
                </div>
              )}
              <div className="split-editor-actions">
                {hasExistingSplit && (
                  <button
                    type="button"
                    className="btn btn-danger btn-md"
                    disabled={saving}
                    onClick={restoreSplit}
                  >
                    {t('transactions.splitRestore')}
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-md" onClick={onClose}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-md"
                  disabled={saving || !preview?.balanced}
                  onClick={saveSplit}
                >
                  {saving ? t('common.saving') : t('transactions.splitSave')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
