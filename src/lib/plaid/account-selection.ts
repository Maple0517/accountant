import type { AccountBase } from 'plaid'

export type PlaidAccountSelectionClient = {
  from(table: string): {
    select(columns: string): PlaidAccountSelectionQuery
    update(payload: Record<string, unknown>): PlaidAccountSelectionQuery
    insert(payload: Record<string, unknown>[]): PlaidAccountSelectionQuery
  }
}

type QueryError = {
  message?: string
}

type QueryResult<T> = {
  data: T | null
  error: QueryError | null
}

type PlaidAccountSelectionQuery<T = unknown> = PromiseLike<QueryResult<T>> & {
  eq(column: string, value: unknown): PlaidAccountSelectionQuery<T>
  is(column: string, value: unknown): PlaidAccountSelectionQuery<T>
  in(column: string, values: unknown[]): PlaidAccountSelectionQuery<T>
  single(): PromiseLike<QueryResult<T>>
}

type PlaidItemRow = {
  id: string
  user_id: string
  access_token: string
}

type LocalAccountRow = {
  id: string
  user_id: string
  plaid_item_id?: string | null
  plaid_account_id?: string | null
  name: string
  official_name?: string | null
  type: string
  subtype?: string | null
  mask?: string | null
  is_manual?: boolean | null
  archived_at?: string | null
  archived_reason?: string | null
}

export type ReconcilePlaidItemAccountsResult = {
  success: true
  plaid_item_id: string
  selected_accounts: number
  added_accounts: number
  reconnected_accounts: number
  disconnected_accounts: number
}

export class PlaidAccountSelectionError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'PlaidAccountSelectionError'
    this.status = status
  }
}

export function mapPlaidType(type: string, subtype: string | null) {
  if (type === 'depository') {
    if (subtype === 'savings') return 'savings'
    return 'checking'
  }
  if (type === 'credit') return 'credit'
  if (type === 'investment') return 'investment'
  return 'other'
}

export function parseSelectedPlaidAccountIds(body: unknown) {
  if (!body || typeof body !== 'object') {
    return null
  }

  const rawIds = (body as { selected_plaid_account_ids?: unknown }).selected_plaid_account_ids
  if (!Array.isArray(rawIds)) {
    return null
  }

  const ids = rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  return ids.length === rawIds.length ? Array.from(new Set(ids)) : null
}

export async function reconcilePlaidItemAccounts({
  supabase,
  userId,
  plaidItemId,
  selectedPlaidAccountIds,
  getPlaidAccounts,
}: {
  supabase: PlaidAccountSelectionClient
  userId: string
  plaidItemId: string
  selectedPlaidAccountIds: string[]
  getPlaidAccounts: (accessToken: string) => Promise<AccountBase[]>
}): Promise<ReconcilePlaidItemAccountsResult> {
  const { data: item, error: itemError } = await supabase
    .from('plaid_items')
    .select('id, user_id, access_token')
    .eq('id', plaidItemId)
    .eq('user_id', userId)
    .single()

  if (itemError || !item) {
    throw new PlaidAccountSelectionError('Plaid connection not found', 404)
  }

  const plaidItem = item as PlaidItemRow
  const selectedSet = new Set(selectedPlaidAccountIds)
  const plaidAccounts = (await getPlaidAccounts(plaidItem.access_token)).filter((account) =>
    selectedSet.has(account.account_id)
  )

  const { data: existingAccounts, error: existingError } = await supabase
    .from('accounts')
    .select('id, user_id, plaid_item_id, plaid_account_id, name, official_name, type, subtype, mask, is_manual, archived_at, archived_reason')
    .eq('user_id', userId)

  if (existingError) {
    throw new PlaidAccountSelectionError(
      `Failed to load local accounts: ${existingError.message || 'unknown error'}`,
      500
    )
  }

  const localAccounts = (existingAccounts || []) as LocalAccountRow[]
  const connectedToItem = localAccounts.filter((account) => account.plaid_item_id === plaidItemId)
  const selectedRows = plaidAccounts.map((account) => toAccountRow(userId, plaidItemId, account))
  let addedAccounts = 0
  let reconnectedAccounts = 0

  for (const selectedRow of selectedRows) {
    const existingConnected = connectedToItem.find(
      (account) => account.plaid_account_id === selectedRow.plaid_account_id
    )

    if (existingConnected) {
      continue
    }

    const disconnectedMatch = findDisconnectedAccountMatch(localAccounts, selectedRow)
    if (disconnectedMatch) {
      const { error } = await supabase
        .from('accounts')
        .update(selectedRow)
        .eq('id', disconnectedMatch.id)
        .eq('user_id', userId)

      if (error) {
        throw new PlaidAccountSelectionError(
          `Failed to reconnect selected account: ${error.message || 'unknown error'}`,
          500
        )
      }

      reconnectedAccounts += 1
      continue
    }

    const { error } = await supabase.from('accounts').insert([selectedRow])
    if (error) {
      throw new PlaidAccountSelectionError(
        `Failed to add selected account: ${error.message || 'unknown error'}`,
        500
      )
    }

    addedAccounts += 1
  }

  const removedPlaidIds = connectedToItem
    .map((account) => account.plaid_account_id)
    .filter((id): id is string => typeof id === 'string' && !selectedSet.has(id))

  if (removedPlaidIds.length > 0) {
    const { error } = await supabase
      .from('accounts')
      .update({
        plaid_item_id: null,
        plaid_account_id: null,
      })
      .eq('user_id', userId)
      .eq('plaid_item_id', plaidItemId)
      .in('plaid_account_id', removedPlaidIds)

    if (error) {
      throw new PlaidAccountSelectionError(
        `Failed to disconnect unselected accounts: ${error.message || 'unknown error'}`,
        500
      )
    }
  }

  return {
    success: true,
    plaid_item_id: plaidItemId,
    selected_accounts: selectedPlaidAccountIds.length,
    added_accounts: addedAccounts,
    reconnected_accounts: reconnectedAccounts,
    disconnected_accounts: removedPlaidIds.length,
  }
}

function toAccountRow(userId: string, plaidItemId: string, account: AccountBase) {
  return {
    user_id: userId,
    plaid_item_id: plaidItemId,
    plaid_account_id: account.account_id,
    name: account.name,
    official_name: account.official_name || null,
    type: mapPlaidType(account.type, account.subtype || null),
    subtype: account.subtype || null,
    mask: account.mask || null,
    current_balance: account.balances.current,
    available_balance: account.balances.available || null,
    iso_currency_code: account.balances.iso_currency_code || 'USD',
    is_manual: false,
    archived_at: null,
    archived_reason: null,
  }
}

function findDisconnectedAccountMatch(
  accounts: LocalAccountRow[],
  selectedRow: ReturnType<typeof toAccountRow>
) {
  const candidates = accounts.filter(
    (account) =>
      !account.is_manual &&
      !account.plaid_item_id &&
      !account.plaid_account_id &&
      account.name === selectedRow.name &&
      account.mask === selectedRow.mask &&
      account.type === selectedRow.type &&
      (account.subtype || null) === selectedRow.subtype
  )

  return candidates.length === 1 ? candidates[0] : null
}
