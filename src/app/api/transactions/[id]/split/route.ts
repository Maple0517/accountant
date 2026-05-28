import { createClient } from '@/lib/supabase/server'
import {
  enqueueNotionSyncOutbox,
  ensureNotionSplitSchemaReady,
} from '@/lib/notion/sync'
import {
  buildSplitNotionJobs,
  getSplitEligibilityIssues,
  makeSplitApiError,
  mapSplitRpcError,
  normalizeSplitRequest,
  validateCanonicalSplitSigns,
  type GetSplitResponse,
} from '@/lib/transactions/split-api'
import type { Transaction, TransactionSplitGroup } from '@/types'

export const dynamic = 'force-dynamic'

type SplitQuery = PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }> & {
  select(columns: string): SplitQuery
  eq(column: string, value: unknown): SplitQuery
  is(column: string, value: null): SplitQuery
  order(column: string, options: { ascending: boolean }): SplitQuery
  single(): Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
  maybeSingle(): Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
}

type SplitQueryClient = {
  from(table: string): SplitQuery
  rpc(fn: string, args: Record<string, unknown>): Promise<{
    data: unknown
    error: { message?: string; code?: string } | null
  }>
}

type SplitRouteDeps = {
  supabase: SplitQueryClient
  userId: string
  transactionId: string
  ensureSchemaReady?: typeof ensureNotionSplitSchemaReady
  enqueueOutbox?: typeof enqueueNotionSyncOutbox
  request?: Request
}

const TRANSACTION_SELECT = `
  id,
  user_id,
  account_id,
  category_id,
  plaid_transaction_id,
  amount,
  iso_currency_code,
  date,
  authorized_date,
  merchant_name,
  description,
  payment_channel,
  pending,
  source,
  receipt_url,
  notion_page_id,
  tags,
  notes,
  transaction_kind,
  budget_behavior,
  linked_transaction_id,
  budget_effective_date,
  refund_match_confidence,
  refund_match_reason,
  transfer_group_id,
  transfer_match_status,
  transfer_match_confidence,
  transfer_match_reason,
  semantic_override_source,
  deleted_at,
  deleted_reason,
  is_hidden_from_reports,
  split_group_id,
  split_parent_id,
  split_role,
  split_sequence,
  split_status,
  effective_date,
  created_at,
  updated_at
`

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return Response.json(
        makeSplitApiError('UNAUTHENTICATED', 401, 'Unauthorized').body,
        { status: 401 }
      )
    }

    const { id } = await context.params
    return handleGetSplit({
      supabase: supabase as unknown as SplitQueryClient,
      userId: user.id,
      transactionId: id,
    })
  } catch (error) {
    console.error('Error loading transaction split:', error)
    const mapped = makeSplitApiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to load transaction split'
    )
    return Response.json(mapped.body, { status: mapped.status })
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return Response.json(
        makeSplitApiError('UNAUTHENTICATED', 401, 'Unauthorized').body,
        { status: 401 }
      )
    }

    const { id } = await context.params
    return handlePutSplit({
      supabase: supabase as unknown as SplitQueryClient,
      userId: user.id,
      transactionId: id,
      request,
    })
  } catch (error) {
    console.error('Error replacing transaction split:', error)
    const mapped = makeSplitApiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to replace transaction split'
    )
    return Response.json(mapped.body, { status: mapped.status })
  }
}

export async function handleGetSplit({
  supabase,
  userId,
  transactionId,
}: SplitRouteDeps) {
  const result = await loadSplitState(supabase, userId, transactionId)
  if (!result.ok) {
    return Response.json(result.error.body, { status: result.error.status })
  }

  return Response.json(result.value)
}

export async function handlePutSplit({
  supabase,
  userId,
  transactionId,
  request,
  ensureSchemaReady = ensureNotionSplitSchemaReady,
  enqueueOutbox = enqueueNotionSyncOutbox,
}: SplitRouteDeps) {
  if (!request) {
    throw new Error('Request is required')
  }

  const body = await request.json()
  const parsed = normalizeSplitRequest(body)
  if (!parsed.ok) {
    return Response.json(parsed.error, { status: parsed.status })
  }

  const state = await loadSplitState(supabase, userId, transactionId)
  if (!state.ok) {
    return Response.json(state.error.body, { status: state.error.status })
  }

  const schemaReadiness = await ensureSchemaReady(userId)
  if (!schemaReadiness.ready) {
    const error = makeSplitApiError(
      'NOTION_SCHEMA_NOT_READY',
      422,
      schemaReadiness.error,
      ['NOTION_SCHEMA_NOT_READY']
    )
    return Response.json(error.body, { status: error.status })
  }

  const issues = getSplitEligibilityIssues(state.value.parent)
  if (issues.includes('PENDING_PARENT_NOT_SUPPORTED')) {
    const error = makeSplitApiError(
      'PENDING_PARENT_NOT_SUPPORTED',
      422,
      'Pending transactions cannot be split in V1',
      issues
    )
    return Response.json(error.body, { status: error.status })
  }
  if (issues.length > 0) {
    const error = makeSplitApiError(
      'INVALID_SPLIT_TARGET',
      422,
      'Transaction cannot be split',
      issues
    )
    return Response.json(error.body, { status: error.status })
  }

  const signIssues = validateCanonicalSplitSigns(
    String(state.value.parent.amount),
    parsed.value.children
  )
  if (signIssues.length > 0) {
    const error = makeSplitApiError(
      'INVALID_CHILD_AMOUNT',
      422,
      'Split child amounts must use the parent transaction sign',
      signIssues
    )
    return Response.json(error.body, { status: error.status })
  }

  const { data, error } = await supabase.rpc('replace_transaction_split', {
    p_transaction_id: state.value.parent.id,
    p_children: parsed.value.children,
    p_expected_version: parsed.value.expected_version ?? null,
  })

  if (error) {
    const mapped = mapSplitRpcError(error)
    return Response.json(mapped.body, { status: mapped.status })
  }

  const response = normalizeRpcSplitResponse(data)
  const warnings: string[] = []

  try {
      await enqueueOutbox(
      supabase as never,
      buildSplitNotionJobs({
        userId,
        parent: response.parent,
        group: response.group,
        children: response.children,
        action: 'replace',
      })
    )
  } catch (error) {
    console.error('Failed to enqueue split Notion sync:', error)
    warnings.push('NOTION_OUTBOX_ENQUEUE_FAILED')
  }

  return Response.json({ ...response, warnings })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return Response.json(
        makeSplitApiError('UNAUTHENTICATED', 401, 'Unauthorized').body,
        { status: 401 }
      )
    }

    const { id } = await context.params
    return handleDeleteSplit({
      supabase: supabase as unknown as SplitQueryClient,
      userId: user.id,
      transactionId: id,
    })
  } catch (error) {
    console.error('Error restoring transaction split:', error)
    const mapped = makeSplitApiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to restore transaction split'
    )
    return Response.json(mapped.body, { status: mapped.status })
  }
}

export async function handleDeleteSplit({
  supabase,
  userId,
  transactionId,
  ensureSchemaReady = ensureNotionSplitSchemaReady,
  enqueueOutbox = enqueueNotionSyncOutbox,
}: SplitRouteDeps) {
  const before = await loadSplitState(supabase, userId, transactionId)
  if (!before.ok) {
    return Response.json(before.error.body, { status: before.error.status })
  }

  const schemaReadiness = await ensureSchemaReady(userId)
  if (!schemaReadiness.ready) {
    const error = makeSplitApiError(
      'NOTION_SCHEMA_NOT_READY',
      422,
      schemaReadiness.error,
      ['NOTION_SCHEMA_NOT_READY']
    )
    return Response.json(error.body, { status: error.status })
  }

  if (!before.value.group) {
    const mapped = makeSplitApiError('NOT_FOUND', 404, 'Split group was not found')
    return Response.json(mapped.body, { status: mapped.status })
  }

  const { data, error } = await supabase.rpc('restore_transaction_split', {
    p_transaction_id: before.value.parent.id,
    p_expected_version: before.value.group.version,
  })

  if (error) {
    const mapped = mapSplitRpcError(error)
    return Response.json(mapped.body, { status: mapped.status })
  }

  const response = normalizeRpcSplitResponse(data)
  const warnings: string[] = []

  try {
    await enqueueOutbox(
      supabase as never,
      buildSplitNotionJobs({
        userId,
        parent: response.parent,
        group: response.group,
        children: before.value.children,
        action: 'restore',
      })
    )
  } catch (error) {
    console.error('Failed to enqueue split restore Notion sync:', error)
    warnings.push('NOTION_OUTBOX_ENQUEUE_FAILED')
  }

  return Response.json({ ...response, warnings })
}

async function loadSplitState(
  supabase: SplitQueryClient,
  userId: string,
  transactionId: string
): Promise<
  | { ok: true; value: GetSplitResponse }
  | { ok: false; error: ReturnType<typeof makeSplitApiError> }
> {
  const transactionQuery = supabase.from('transactions')
  const transactionResult = await transactionQuery
    .select(TRANSACTION_SELECT)
    .eq('id', transactionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (transactionResult.error || !transactionResult.data) {
    return {
      ok: false,
      error: makeSplitApiError('NOT_FOUND', 404, 'Transaction was not found'),
    }
  }

  const clicked = transactionResult.data as Transaction
  const parentId =
    clicked.split_role === 'child' && clicked.split_parent_id
      ? clicked.split_parent_id
      : clicked.id

  const parent =
    parentId === clicked.id
      ? clicked
      : await loadTransactionById(supabase, userId, parentId)

  if (!parent) {
    return {
      ok: false,
      error: makeSplitApiError('NOT_FOUND', 404, 'Split parent was not found'),
    }
  }

  const group = parent.split_group_id
    ? await loadSplitGroup(supabase, userId, parent.split_group_id)
    : null
  const children = parent.split_group_id
    ? await loadSplitChildren(supabase, userId, parent.split_group_id)
    : []
  const issues = getSplitEligibilityIssues(parent)

  return {
    ok: true,
    value: {
      parent,
      group,
      children,
      canSplit: issues.length === 0,
      issues,
      sourceParentStillExists: !parent.deleted_at,
      isOrphaned: parent.split_status === 'orphaned' || group?.status === 'orphaned',
    },
  }
}

async function loadTransactionById(
  supabase: SplitQueryClient,
  userId: string,
  transactionId: string
) {
  const query = supabase.from('transactions')
  const { data } = await query
    .select(TRANSACTION_SELECT)
    .eq('id', transactionId)
    .eq('user_id', userId)
    .maybeSingle()

  return (data as Transaction | null) ?? null
}

async function loadSplitGroup(
  supabase: SplitQueryClient,
  userId: string,
  splitGroupId: string
) {
  const query = supabase.from('transaction_split_groups')
  const { data } = await query
    .select('*')
    .eq('id', splitGroupId)
    .eq('user_id', userId)
    .maybeSingle()

  return (data as TransactionSplitGroup | null) ?? null
}

async function loadSplitChildren(
  supabase: SplitQueryClient,
  userId: string,
  splitGroupId: string
) {
  const query = supabase.from('transactions')
  const { data } = await query
    .select(TRANSACTION_SELECT)
    .eq('user_id', userId)
    .eq('split_group_id', splitGroupId)
    .eq('split_role', 'child')
    .is('deleted_at', null)
    .order('split_sequence', { ascending: true })

  return ((data as Transaction[] | null) ?? [])
}

function normalizeRpcSplitResponse(data: unknown) {
  const raw = (data || {}) as {
    parent?: Transaction
    group?: TransactionSplitGroup | null
    children?: Transaction[]
  }

  return {
    parent: raw.parent as Transaction,
    group: (raw.group ?? null) as TransactionSplitGroup | null,
    children: (raw.children ?? []) as Transaction[],
  }
}
