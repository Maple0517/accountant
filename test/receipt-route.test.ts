import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getOrCreateIosCaptureAccount,
  normalizeIosCaptureCurrency,
} from '@/app/api/receipt/route'

function createAccountsSupabaseStub({
  lookupResult,
  insertResult,
}: {
  lookupResult: { id: string; name: string } | null
  insertResult: { id: string } | null
}) {
  const lookupFilters: Array<{ column: string; value: unknown }> = []
  let insertPayload: Record<string, unknown> | null = null

  const accountsQuery = {
    select(columns: string) {
      lookupFilters.push({ column: 'select', value: columns })
      return accountsQuery
    },
    eq(column: string, value: unknown) {
      lookupFilters.push({ column, value })
      return accountsQuery
    },
    in(column: string, value: unknown) {
      lookupFilters.push({ column, value })
      return accountsQuery
    },
    async maybeSingle() {
      return { data: lookupResult, error: null }
    },
    then(onfulfilled?: (value: { data: Array<{ id: string; name: string }>; error: null }) => unknown, onrejected?: (reason: unknown) => unknown) {
      return Promise.resolve({
        data: lookupResult ? [lookupResult] : [],
        error: null,
      }).then(onfulfilled, onrejected)
    },
    insert(payload: Record<string, unknown>) {
      insertPayload = payload
      return {
        select() {
          return {
            single(): Promise<
              { data: { id: string } | null; error: null | { message: string } }
            > {
              return Promise.resolve(
                insertResult
                  ? { data: insertResult, error: null }
                  : { data: null, error: { message: 'insert failed' } }
              )
            },
          }
        },
      }
    },
  }

  return {
    lookupFilters,
    get insertPayload() {
      return insertPayload
    },
    supabase: {
      from(table: string) {
        assert.equal(table, 'accounts')
        return accountsQuery
      },
    },
  }
}

test('normalizeIosCaptureCurrency trims and uppercases the capture currency', () => {
  assert.equal(normalizeIosCaptureCurrency(' usd '), 'USD')
  assert.equal(normalizeIosCaptureCurrency(undefined), 'USD')
})

test('getOrCreateIosCaptureAccount reuses a same-currency legacy iOS Capture account', async () => {
  const stub = createAccountsSupabaseStub({
    lookupResult: { id: 'acc_legacy_usd', name: 'iOS Capture' },
    insertResult: null,
  })

  const accountId = await getOrCreateIosCaptureAccount(
    'user_1',
    'usd',
    stub.supabase as never
  )

  assert.equal(accountId, 'acc_legacy_usd')
  assert.deepEqual(stub.lookupFilters, [
    { column: 'select', value: 'id, name' },
    { column: 'user_id', value: 'user_1' },
    { column: 'is_manual', value: true },
    { column: 'iso_currency_code', value: 'USD' },
    { column: 'name', value: ['iOS Capture USD', 'iOS Capture'] },
  ])
  assert.equal(stub.insertPayload, null)
})

test('getOrCreateIosCaptureAccount reuses a same-currency iOS Capture currency-specific account', async () => {
  const stub = createAccountsSupabaseStub({
    lookupResult: { id: 'acc_usd', name: 'iOS Capture USD' },
    insertResult: null,
  })

  const accountId = await getOrCreateIosCaptureAccount(
    'user_1',
    'USD',
    stub.supabase as never
  )

  assert.equal(accountId, 'acc_usd')
  assert.equal(stub.insertPayload, null)
})

test('getOrCreateIosCaptureAccount creates a currency-specific account name', async () => {
  const stub = createAccountsSupabaseStub({
    lookupResult: null,
    insertResult: { id: 'acc_new_cny' },
  })

  const accountId = await getOrCreateIosCaptureAccount(
    'user_1',
    'cny',
    stub.supabase as never
  )

  assert.equal(accountId, 'acc_new_cny')
  assert.equal(stub.insertPayload?.name, 'iOS Capture CNY')
  assert.equal(stub.insertPayload?.iso_currency_code, 'CNY')
  assert.equal(stub.insertPayload?.is_manual, true)
})
