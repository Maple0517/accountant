import test from 'node:test'
import assert from 'node:assert/strict'

import {
  handleDeleteSplit,
  handleGetSplit,
  handlePutSplit,
} from '@/app/api/transactions/[id]/split/route'
import type { Transaction, TransactionSplitGroup } from '@/types'

type TableRows = Record<string, Array<Record<string, unknown>>>

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<{ column: string; value: unknown; op: 'eq' | 'is' }> = []
  private orderedBy: string | null = null

  constructor(
    private readonly table: string,
    private readonly rows: TableRows
  ) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value, op: 'eq' })
    return this
  }

  is(column: string, value: null) {
    this.filters.push({ column, value, op: 'is' })
    return this
  }

  order(column: string) {
    this.orderedBy = column
    return this
  }

  async single() {
    return this.maybeSingle()
  }

  async maybeSingle() {
    const data = this.matchRows()[0] ?? null
    return { data, error: null }
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.matchRows(), error: null }).then(
      onfulfilled,
      onrejected
    )
  }

  private matchRows() {
    const rows = [...(this.rows[this.table] || [])]
    const filtered = rows.filter((row) =>
      this.filters.every((filter) => {
        if (filter.op === 'is') {
          return row[filter.column] === filter.value
        }
        return row[filter.column] === filter.value
      })
    )

    if (this.orderedBy) {
      filtered.sort((left, right) =>
        String(left[this.orderedBy!] ?? '').localeCompare(
          String(right[this.orderedBy!] ?? '')
        )
      )
    }

    return filtered
  }
}

function makeTransaction(
  patch: Partial<Transaction> & Pick<Transaction, 'id'>
): Transaction {
  return {
    id: patch.id,
    user_id: patch.user_id ?? 'user_1',
    account_id: patch.account_id ?? 'account_1',
    amount: patch.amount ?? 100,
    date: patch.date ?? '2026-05-25',
    description: patch.description ?? 'Transaction',
    pending: patch.pending ?? false,
    source: patch.source ?? 'plaid',
    split_role: patch.split_role ?? 'none',
    split_status: patch.split_status ?? null,
    split_group_id: patch.split_group_id ?? null,
    split_parent_id: patch.split_parent_id ?? null,
    split_sequence: patch.split_sequence ?? null,
    is_hidden_from_reports: patch.is_hidden_from_reports ?? false,
    deleted_at: patch.deleted_at ?? null,
    created_at: patch.created_at ?? '2026-05-25T00:00:00Z',
    updated_at: patch.updated_at ?? '2026-05-25T00:00:00Z',
  }
}

function makeGroup(patch: Partial<TransactionSplitGroup> = {}): TransactionSplitGroup {
  return {
    id: patch.id ?? 'group_1',
    user_id: patch.user_id ?? 'user_1',
    parent_transaction_id: patch.parent_transaction_id ?? 'parent_1',
    status: patch.status ?? 'balanced',
    parent_amount_snapshot: patch.parent_amount_snapshot ?? 100,
    child_amount_sum: patch.child_amount_sum ?? 100,
    iso_currency_code: patch.iso_currency_code ?? 'USD',
    version: patch.version ?? 1,
    created_at: patch.created_at ?? '2026-05-25T00:00:00Z',
    updated_at: patch.updated_at ?? '2026-05-25T00:00:00Z',
  }
}

function makeSupabase(rows: TableRows, rpcData?: unknown) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  return {
    rpcCalls,
    from(table: string) {
      return new FakeQuery(table, rows)
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args })
      return { data: rpcData ?? null, error: null }
    },
  }
}

const schemaReady = async () => ({ ready: true as const, status: 'disabled' as const })

test('GET split route resolves a clicked child back to its parent group', async () => {
  const parent = makeTransaction({
    id: 'parent_1',
    split_role: 'parent',
    split_group_id: 'group_1',
    is_hidden_from_reports: true,
  })
  const child = makeTransaction({
    id: 'child_1',
    source: 'split',
    split_role: 'child',
    split_parent_id: 'parent_1',
    split_group_id: 'group_1',
    split_sequence: 1,
  })
  const supabase = makeSupabase({
    transactions: [parent, child],
    transaction_split_groups: [makeGroup()],
  })

  const response = await handleGetSplit({
    supabase: supabase as never,
    userId: 'user_1',
    transactionId: 'child_1',
    ensureSchemaReady: schemaReady,
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.parent.id, 'parent_1')
  assert.equal(body.group.id, 'group_1')
  assert.deepEqual(body.children.map((tx: Transaction) => tx.id), ['child_1'])
})

test('GET split route does not block opening on Notion schema readiness', async () => {
  const supabase = makeSupabase({
    transactions: [makeTransaction({ id: 'parent_1' })],
    transaction_split_groups: [],
  })
  let schemaChecks = 0

  const response = await handleGetSplit({
    supabase: supabase as never,
    userId: 'user_1',
    transactionId: 'parent_1',
    ensureSchemaReady: async () => {
      schemaChecks += 1
      return {
        ready: false as const,
        status: 'schema_update_failed' as const,
        error: 'missing schema',
      }
    },
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.canSplit, true)
  assert.equal(body.notionSchemaReady, undefined)
  assert.equal(body.issues.includes('NOTION_SCHEMA_NOT_READY'), false)
  assert.equal(schemaChecks, 0)
})

test('PUT split route rejects pending parents before calling RPC', async () => {
  const supabase = makeSupabase({
    transactions: [makeTransaction({ id: 'parent_1', pending: true })],
    transaction_split_groups: [],
  })

  const response = await handlePutSplit({
    supabase: supabase as never,
    userId: 'user_1',
    transactionId: 'parent_1',
    ensureSchemaReady: schemaReady,
    request: new Request('http://test/split', {
      method: 'PUT',
      body: JSON.stringify({
        children: [
          { amount_decimal: '50', transaction_kind: 'normal', budget_behavior: 'count_as_spending' },
          { amount_decimal: '50', transaction_kind: 'normal', budget_behavior: 'count_as_spending' },
        ],
      }),
    }),
  })
  const body = await response.json()

  assert.equal(response.status, 422)
  assert.equal(body.code, 'PENDING_PARENT_NOT_SUPPORTED')
  assert.equal(supabase.rpcCalls.length, 0)
})

test('PUT split route calls replace RPC and enqueues Notion jobs after success', async () => {
  const parent = makeTransaction({ id: 'parent_1' })
  const child = makeTransaction({
    id: 'child_1',
    source: 'split',
    split_role: 'child',
    split_parent_id: 'parent_1',
    split_group_id: 'group_1',
  })
  const group = makeGroup()
  const supabase = makeSupabase(
    {
      transactions: [parent],
      transaction_split_groups: [],
    },
    { parent, group, children: [child] }
  )
  const enqueued: unknown[] = []

  const response = await handlePutSplit({
    supabase: supabase as never,
    userId: 'user_1',
    transactionId: 'parent_1',
    ensureSchemaReady: schemaReady,
    enqueueOutbox: async (_client, jobs) => {
      enqueued.push(...jobs)
      return { enqueued: jobs.length }
    },
    request: new Request('http://test/split', {
      method: 'PUT',
      body: JSON.stringify({
        expected_version: 1,
        children: [
          { amount_decimal: '60', transaction_kind: 'normal', budget_behavior: 'count_as_spending' },
          { amount_decimal: '40', transaction_kind: 'normal', budget_behavior: 'count_as_spending' },
        ],
      }),
    }),
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.parent.id, 'parent_1')
  assert.equal(supabase.rpcCalls[0].fn, 'replace_transaction_split')
  assert.equal(enqueued.length, 3)
})

test('DELETE split route restores parent and enqueues restore jobs', async () => {
  const parent = makeTransaction({
    id: 'parent_1',
    split_role: 'parent',
    split_group_id: 'group_1',
  })
  const child = makeTransaction({
    id: 'child_1',
    source: 'split',
    split_role: 'child',
    split_parent_id: 'parent_1',
    split_group_id: 'group_1',
  })
  const restoredParent = makeTransaction({ id: 'parent_1', split_role: 'none' })
  const group = makeGroup({ version: 2, status: 'restored' })
  const supabase = makeSupabase(
    {
      transactions: [parent, child],
      transaction_split_groups: [makeGroup({ version: 1 })],
    },
    { parent: restoredParent, group, children: [] }
  )
  const enqueued: unknown[] = []

  const response = await handleDeleteSplit({
    supabase: supabase as never,
    userId: 'user_1',
    transactionId: 'parent_1',
    ensureSchemaReady: schemaReady,
    enqueueOutbox: async (_client, jobs) => {
      enqueued.push(...jobs)
      return { enqueued: jobs.length }
    },
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.parent.split_role, 'none')
  assert.equal(supabase.rpcCalls[0].fn, 'restore_transaction_split')
  assert.deepEqual(
    enqueued.map((job) => (job as { jobType: string }).jobType),
    ['restore_split_parent', 'archive_or_mark_child_deleted']
  )
})
