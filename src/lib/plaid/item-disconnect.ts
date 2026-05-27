export type PlaidItemDisconnectMode = 'preserve_history' | 'delete_history'

type QueryError = {
  message?: string
}

type PlaidApiErrorLike = {
  error_code?: unknown
  response?: {
    data?: {
      error_code?: unknown
    }
  }
}

export function getPlaidApiErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const plaidError = error as PlaidApiErrorLike
  const directCode = plaidError.error_code
  if (typeof directCode === 'string') {
    return directCode
  }

  const responseCode = plaidError.response?.data?.error_code
  return typeof responseCode === 'string' ? responseCode : null
}

export function isPlaidItemNotFoundError(error: unknown) {
  return getPlaidApiErrorCode(error) === 'ITEM_NOT_FOUND'
}

type QueryResult<T> = {
  data: T | null
  error: QueryError | null
}

type ExecutableQuery<T = unknown> = PromiseLike<QueryResult<T>> & {
  eq(column: string, value: unknown): ExecutableQuery<T>
  in(column: string, values: unknown[]): ExecutableQuery<T>
  single(): PromiseLike<QueryResult<T>>
}

export type PlaidItemDisconnectClient = {
  rpc(
    fn: 'soft_delete_transactions_for_trusted_sync',
    args: {
      p_user_id: string
      p_transaction_ids: string[] | null
      p_plaid_transaction_ids: string[] | null
      p_deleted_reason: string
    }
  ): PromiseLike<QueryResult<number>>
  from(table: string): {
    select(columns: string): ExecutableQuery
    update(payload: Record<string, unknown>): ExecutableQuery
    delete(): ExecutableQuery
  }
}

export type PlaidItemDisconnectResult = {
  success: true
  mode: PlaidItemDisconnectMode
  plaid_item_id: string
  disconnected_accounts: number
  deleted_transactions: number
}

type PlaidItemRow = {
  id: string
  user_id: string
  access_token: string
  institution_name?: string | null
}

type AccountRow = {
  id: string
}

type TransactionRow = {
  id: string
}

export function parsePlaidItemDisconnectMode(body: unknown): PlaidItemDisconnectMode | null {
  if (!body || typeof body !== 'object' || !('mode' in body)) {
    return 'preserve_history'
  }

  const mode = (body as { mode?: unknown }).mode
  if (mode === 'preserve_history' || mode === 'delete_history') {
    return mode
  }

  return null
}

export async function disconnectPlaidItem({
  supabase,
  userId,
  plaidItemId,
  mode,
  removePlaidItem,
}: {
  supabase: PlaidItemDisconnectClient
  userId: string
  plaidItemId: string
  mode: PlaidItemDisconnectMode
  removePlaidItem: (accessToken: string) => Promise<unknown>
}): Promise<PlaidItemDisconnectResult> {
  const { data: item, error: itemError } = await supabase
    .from('plaid_items')
    .select('id, user_id, access_token, institution_name')
    .eq('id', plaidItemId)
    .eq('user_id', userId)
    .single()

  if (itemError || !item) {
    throw new PlaidItemDisconnectError('Plaid connection not found', 404)
  }

  const plaidItem = item as PlaidItemRow
  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('plaid_item_id', plaidItem.id)

  if (accountsError) {
    throw new PlaidItemDisconnectError(
      `Failed to load connected accounts: ${accountsError.message || 'unknown error'}`,
      500
    )
  }

  const accountIds = ((accounts || []) as AccountRow[]).map((account) => account.id)
  const transactionIds =
    mode === 'delete_history' && accountIds.length > 0
      ? await loadTransactionIdsForAccounts(supabase, userId, accountIds)
      : []

  try {
    await removePlaidItem(plaidItem.access_token)
  } catch (error) {
    if (!isPlaidItemNotFoundError(error)) {
      throw error
    }
  }

  if (mode === 'preserve_history') {
    await preserveAccountHistory(supabase, userId, plaidItem.id)
  } else {
    await deleteConnectionHistory({
      supabase,
      userId,
      plaidItemId: plaidItem.id,
      accountIds,
      transactionIds,
    })
  }

  await deletePlaidItemRow(supabase, userId, plaidItem.id)

  return {
    success: true,
    mode,
    plaid_item_id: plaidItem.id,
    disconnected_accounts: accountIds.length,
    deleted_transactions: mode === 'delete_history' ? transactionIds.length : 0,
  }
}

async function loadTransactionIdsForAccounts(
  supabase: PlaidItemDisconnectClient,
  userId: string,
  accountIds: string[]
) {
  const { data, error } = await supabase
    .from('transactions')
    .select('id')
    .eq('user_id', userId)
    .in('account_id', accountIds)

  if (error) {
    throw new PlaidItemDisconnectError(
      `Failed to load transactions for connection: ${error.message || 'unknown error'}`,
      500
    )
  }

  return ((data || []) as TransactionRow[]).map((transaction) => transaction.id)
}

async function preserveAccountHistory(
  supabase: PlaidItemDisconnectClient,
  userId: string,
  plaidItemId: string
) {
  const { error } = await supabase
    .from('accounts')
    .update({
      plaid_item_id: null,
      plaid_account_id: null,
    })
    .eq('user_id', userId)
    .eq('plaid_item_id', plaidItemId)

  if (error) {
    throw new PlaidItemDisconnectError(
      `Failed to preserve account history: ${error.message || 'unknown error'}`,
      500
    )
  }
}

async function deleteConnectionHistory({
  supabase,
  userId,
  plaidItemId,
  accountIds,
  transactionIds,
}: {
  supabase: PlaidItemDisconnectClient
  userId: string
  plaidItemId: string
  accountIds: string[]
  transactionIds: string[]
}) {
  if (transactionIds.length > 0) {
    await clearLinkedTransactionReferences(supabase, userId, transactionIds)
    await deleteAiClassificationJobItems(supabase, userId, transactionIds)
    await softDeleteTransactions(supabase, userId, transactionIds)
  }

  if (accountIds.length > 0) {
    const { error } = await supabase
      .from('accounts')
      .update({
        plaid_item_id: null,
        plaid_account_id: null,
      })
      .eq('user_id', userId)
      .eq('plaid_item_id', plaidItemId)

    if (error) {
      throw new PlaidItemDisconnectError(
        `Failed to preserve connected accounts: ${error.message || 'unknown error'}`,
        500
      )
    }
  }
}

async function clearLinkedTransactionReferences(
  supabase: PlaidItemDisconnectClient,
  userId: string,
  transactionIds: string[]
) {
  const { error } = await supabase
    .from('transactions')
    .update({
      linked_transaction_id: null,
      refund_match_confidence: null,
      refund_match_reason: null,
    })
    .eq('user_id', userId)
    .in('linked_transaction_id', transactionIds)

  if (error) {
    throw new PlaidItemDisconnectError(
      `Failed to clear linked transaction references: ${error.message || 'unknown error'}`,
      500
    )
  }
}

async function deleteAiClassificationJobItems(
  supabase: PlaidItemDisconnectClient,
  userId: string,
  transactionIds: string[]
) {
  const { error } = await supabase
    .from('ai_classification_job_items')
    .delete()
    .eq('user_id', userId)
    .in('transaction_id', transactionIds)

  if (error) {
    throw new PlaidItemDisconnectError(
      `Failed to delete AI classification queue items: ${error.message || 'unknown error'}`,
      500
    )
  }
}

async function softDeleteTransactions(
  supabase: PlaidItemDisconnectClient,
  userId: string,
  transactionIds: string[]
) {
  const { error } = await supabase.rpc(
    'soft_delete_transactions_for_trusted_sync',
    {
      p_user_id: userId,
      p_transaction_ids: transactionIds,
      p_plaid_transaction_ids: null,
      p_deleted_reason: 'plaid_disconnect_delete_history',
    }
  )

  if (error) {
    throw new PlaidItemDisconnectError(
      `Failed to soft-delete connection transactions: ${error.message || 'unknown error'}`,
      500
    )
  }
}

async function deletePlaidItemRow(
  supabase: PlaidItemDisconnectClient,
  userId: string,
  plaidItemId: string
) {
  const { error } = await supabase
    .from('plaid_items')
    .delete()
    .eq('id', plaidItemId)
    .eq('user_id', userId)

  if (error) {
    throw new PlaidItemDisconnectError(
      `Failed to delete Plaid connection token: ${error.message || 'unknown error'}`,
      500
    )
  }
}

export class PlaidItemDisconnectError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'PlaidItemDisconnectError'
    this.status = status
  }
}
