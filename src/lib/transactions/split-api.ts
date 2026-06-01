import { z } from 'zod'
import { getBudgetSemanticAmounts } from '@/lib/transactions/effective'
import { normalizeTransactionSemantics } from '@/lib/transactions/treatment'
import type {
  RefundSource,
  Transaction,
  TransactionSplitGroup,
  TransactionTreatment,
} from '@/types'

export type SplitApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'PENDING_PARENT_NOT_SUPPORTED'
  | 'UNBALANCED_SPLIT'
  | 'STALE_VERSION'
  | 'INVALID_CHILD_AMOUNT'
  | 'INVALID_CHILD_REFERENCE'
  | 'INVALID_SPLIT_TARGET'
  | 'SPLIT_WRITE_GUARD_REJECTED'
  | 'NOTION_SCHEMA_NOT_READY'
  | 'INTERNAL_ERROR'

export type SplitApiError = {
  error: string
  code: SplitApiErrorCode
  issues?: string[]
}

export type SplitChildInput = {
  id?: string
  amount_decimal: string
  category_id: string | null
  allocation_date?: string | null
  treatment?: TransactionTreatment
  refund_source?: RefundSource | null
  linked_transaction_id?: string | null
  merchant_name?: string | null
  description?: string | null
  notes?: string | null
}

export type ReplaceSplitRequest = {
  expected_version?: number | null
  children: SplitChildInput[]
}

export type SplitPreviewResponse = {
  balanced: boolean
  parentAmountDecimal: string
  childAmountSumDecimal: string
  remainingAmountDecimal: string
  budgetImpactByMonth: Array<{
    month: string
    netSpendingDeltaDecimal: string
    incomeDeltaDecimal: string
    categories: Array<{
      categoryId: string | null
      amountDecimal: string
    }>
  }>
  warnings: string[]
}

export type GetSplitResponse = {
  parent: Transaction
  group: TransactionSplitGroup | null
  children: Transaction[]
  canSplit: boolean
  issues: string[]
  notionSchemaReady?: boolean
  notionSchemaStatus?: 'disabled' | 'ready' | 'not_configured' | 'schema_update_failed'
  sourceParentStillExists: boolean
  isOrphaned: boolean
}

type RpcErrorLike = {
  message?: string
  code?: string
}

const moneyPattern = /^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const uuidSchema = z.string().uuid()
const optionalUuidSchema = z.union([uuidSchema, z.literal(''), z.null()]).optional()

export const splitChildSchema = z.object({
  id: optionalUuidSchema,
  amount_decimal: z.string().trim().regex(moneyPattern),
  category_id: z.union([uuidSchema, z.literal(''), z.null()]).optional(),
  allocation_date: z.union([z.string().regex(datePattern), z.literal(''), z.null()]).optional(),
  treatment: z
    .enum(['spending', 'income', 'refund', 'transfer', 'excluded'])
    .optional(),
  refund_source: z
    .enum(['merchant_refund', 'reimbursement'])
    .nullable()
    .optional(),
  linked_transaction_id: optionalUuidSchema,
  merchant_name: z.union([z.string().trim().max(200), z.literal(''), z.null()]).optional(),
  description: z.union([z.string().trim().max(500), z.literal(''), z.null()]).optional(),
  notes: z.union([z.string().trim().max(1000), z.literal(''), z.null()]).optional(),
})

export const replaceSplitSchema = z.object({
  expected_version: z.number().int().positive().nullable().optional(),
  children: z.array(splitChildSchema).min(2).max(20),
})

export function makeSplitApiError(
  code: SplitApiErrorCode,
  status: number,
  error: string,
  issues?: string[]
) {
  return {
    body: { error, code, ...(issues && issues.length > 0 ? { issues } : {}) },
    status,
  }
}

export function normalizeSplitRequest(body: unknown):
  | { ok: true; value: ReplaceSplitRequest }
  | { ok: false; error: SplitApiError; status: number } {
  const parsed = replaceSplitSchema.safeParse(body)

  if (!parsed.success) {
    const mapped = makeSplitApiError(
      'INVALID_CHILD_AMOUNT',
      422,
      'Invalid split request',
      parsed.error.issues.map((issue) => issue.message)
    )
    return {
      ok: false,
      error: mapped.body,
      status: mapped.status,
    }
  }

  return {
    ok: true,
    value: {
      expected_version: parsed.data.expected_version ?? null,
      children: parsed.data.children.map((child) => {
        const semantics = normalizeTransactionSemantics({
          treatment: child.treatment,
          refundSource: child.refund_source ?? undefined,
          amount: Number(child.amount_decimal),
        })
        return {
          id: emptyToUndefined(child.id),
          amount_decimal: normalizeDecimalString(child.amount_decimal),
          category_id: emptyToNull(child.category_id),
          allocation_date: emptyToNull(child.allocation_date),
          treatment: semantics.treatment,
          refund_source: semantics.refundSource,
          linked_transaction_id: emptyToNull(child.linked_transaction_id),
          merchant_name: emptyToNull(child.merchant_name),
          description: emptyToNull(child.description),
          notes: emptyToNull(child.notes),
        }
      }),
    },
  }
}

export function validateCanonicalSplitSigns(
  parentAmountDecimal: string,
  children: SplitChildInput[]
) {
  const parentAmount = decimalToMinor(parentAmountDecimal)
  if (parentAmount === 0) {
    return []
  }

  const expectedSign = Math.sign(parentAmount)
  return children
    .map((child, index) => ({ child, index }))
    .filter(({ child }) => {
      const childAmount = decimalToMinor(child.amount_decimal)
      return childAmount !== 0 && Math.sign(childAmount) !== expectedSign
    })
    .map(({ index }) => `children.${index}.amount_decimal has the wrong sign`)
}

export function buildSplitPreview(
  parent: Pick<
    Transaction,
    | 'amount'
    | 'treatment'
    | 'refund_source'
    | 'budget_effective_date'
    | 'effective_date'
    | 'date'
  >,
  children: SplitChildInput[],
  options: { excludedCategoryIds?: Set<string> } = {}
): SplitPreviewResponse {
  const parentAmount = decimalToMinor(String(parent.amount))
  const childAmountSum = children.reduce(
    (sum, child) => sum + decimalToMinor(child.amount_decimal),
    0
  )
  const remaining = parentAmount - childAmountSum
  const warnings: string[] = []
  const signIssues = validateCanonicalSplitSigns(String(parent.amount), children)
  if (signIssues.length > 0) {
    warnings.push(...signIssues)
  }

  const monthMap = new Map<
    string,
    {
      netSpending: number
      income: number
      categories: Map<string, number>
    }
  >()

  for (const child of children) {
    const date = child.allocation_date || parent.effective_date || parent.budget_effective_date || parent.date
    const month = date.slice(0, 7)
    const bucket =
      monthMap.get(month) ||
      {
        netSpending: 0,
        income: 0,
        categories: new Map<string, number>(),
    }
    const amount = decimalToMinor(child.amount_decimal)
    const semanticAmounts = getBudgetSemanticAmounts({
      amount: amount / 10000,
      treatment: child.treatment,
      refund_source: child.refund_source,
      category_is_excluded_from_budget:
        child.category_id != null &&
        options.excludedCategoryIds?.has(child.category_id) === true,
    })
    const categoryKey = child.category_id ?? ''
    bucket.netSpending += decimalToMinor(String(semanticAmounts.netSpending))
    bucket.income += decimalToMinor(String(semanticAmounts.income))
    const categoryImpact = decimalToMinor(String(semanticAmounts.categoryNetSpend))
    if (categoryImpact !== 0) {
      bucket.categories.set(
        categoryKey,
        (bucket.categories.get(categoryKey) || 0) + categoryImpact
      )
    }
    monthMap.set(month, bucket)
  }

  return {
    balanced: remaining === 0,
    parentAmountDecimal: minorToDecimal(parentAmount),
    childAmountSumDecimal: minorToDecimal(childAmountSum),
    remainingAmountDecimal: minorToDecimal(remaining),
    budgetImpactByMonth: Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, bucket]) => ({
        month,
        netSpendingDeltaDecimal: minorToDecimal(bucket.netSpending),
        incomeDeltaDecimal: minorToDecimal(bucket.income),
        categories: Array.from(bucket.categories.entries()).map(
          ([categoryId, amount]) => ({
            categoryId: categoryId || null,
            amountDecimal: minorToDecimal(amount),
          })
        ),
      })),
    warnings,
  }
}

export function getSplitEligibilityIssues(
  parent: Pick<Transaction, 'pending' | 'deleted_at' | 'split_role' | 'split_status'>
) {
  const issues: string[] = []
  if (parent.pending) issues.push('PENDING_PARENT_NOT_SUPPORTED')
  if (parent.deleted_at) issues.push('DELETED_TRANSACTION_NOT_SUPPORTED')
  if (parent.split_role === 'child') issues.push('INVALID_SPLIT_TARGET')
  if (parent.split_status === 'orphaned') issues.push('ORPHANED_SPLIT_NOT_SUPPORTED')
  return issues
}

export function mapSplitRpcError(error: RpcErrorLike | null | undefined) {
  const message = error?.message || 'Split operation failed'
  const lower = message.toLowerCase()

  if (error?.code === '40001' || lower.includes('stale split version')) {
    return makeSplitApiError('STALE_VERSION', 409, 'Split version is stale')
  }
  if (lower.includes('balance') || lower.includes('unbalanced')) {
    return makeSplitApiError('UNBALANCED_SPLIT', 409, 'Split children must balance to parent amount')
  }
  if (lower.includes('pending transactions cannot be split')) {
    return makeSplitApiError(
      'PENDING_PARENT_NOT_SUPPORTED',
      422,
      'Pending transactions cannot be split in V1'
    )
  }
  if (lower.includes('invalid child') || lower.includes('invalid linked')) {
    return makeSplitApiError('INVALID_CHILD_REFERENCE', 422, message)
  }
  if (lower.includes('split/protected') || lower.includes('protected transaction fields')) {
    return makeSplitApiError('SPLIT_WRITE_GUARD_REJECTED', 422, message)
  }
  if (error?.code === 'P0002' || lower.includes('not found')) {
    return makeSplitApiError('NOT_FOUND', 404, 'Transaction split was not found')
  }
  if (error?.code === '42501') {
    return makeSplitApiError('NOT_FOUND', 404, 'Transaction split was not found')
  }

  return makeSplitApiError('INTERNAL_ERROR', 500, message)
}

export function buildSplitNotionJobs({
  userId,
  parent,
  group,
  children,
  action,
}: {
  userId: string
  parent: Pick<Transaction, 'id'>
  group: Pick<TransactionSplitGroup, 'id' | 'version'> | null
  children: Array<Pick<Transaction, 'id'>>
  action: 'replace' | 'restore'
}) {
  if (!group) return []

  if (action === 'restore') {
    return [
      {
        userId,
        transactionId: parent.id,
        splitGroupId: group.id,
        jobType: 'restore_split_parent' as const,
        idempotencyKey: `split-restore:${group.id}:version:${group.version}`,
      },
      ...children.map((child) => ({
        userId,
        transactionId: child.id,
        splitGroupId: group.id,
        jobType: 'archive_or_mark_child_deleted' as const,
        idempotencyKey: `split-child-archive:${child.id}:group:${group.id}:version:${group.version}`,
      })),
    ]
  }

  return [
    {
      userId,
      transactionId: parent.id,
      splitGroupId: group.id,
      jobType: 'mark_split_parent_hidden' as const,
      idempotencyKey: `split-parent-hidden:${parent.id}:version:${group.version}`,
    },
    {
      userId,
      transactionId: parent.id,
      splitGroupId: group.id,
      jobType: 'sync_split_group' as const,
      idempotencyKey: `split-group:${group.id}:version:${group.version}`,
    },
    ...children.map((child) => ({
      userId,
      transactionId: child.id,
      splitGroupId: group.id,
      jobType: 'sync_effective_transaction' as const,
      idempotencyKey: `split-child-sync:${child.id}:group:${group.id}:version:${group.version}`,
    })),
  ]
}

export function decimalToMinor(value: string | number) {
  const raw = String(value).trim()
  if (!moneyPattern.test(raw)) {
    throw new Error(`Invalid decimal value: ${raw}`)
  }
  const sign = raw.startsWith('-') ? -1 : 1
  const unsigned = raw.replace(/^-/, '')
  const [whole, fraction = ''] = unsigned.split('.')
  return sign * (Number(whole) * 10000 + Number(fraction.padEnd(4, '0')))
}

export function minorToDecimal(value: number) {
  const sign = value < 0 ? '-' : ''
  const absolute = Math.abs(value)
  const whole = Math.floor(absolute / 10000)
  const fraction = String(absolute % 10000).padStart(4, '0').replace(/0+$/, '')
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`
}

export function normalizeDecimalString(value: string) {
  return minorToDecimal(decimalToMinor(value))
}

function emptyToNull(value: string | null | undefined) {
  const trimmed = typeof value === 'string' ? value.trim() : value
  return trimmed === '' || trimmed == null ? null : trimmed
}

function emptyToUndefined(value: string | null | undefined) {
  const normalized = emptyToNull(value)
  return normalized ?? undefined
}
