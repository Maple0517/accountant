import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')

function readMigration(name: string) {
  return readFileSync(join(migrationsDir, name), 'utf8')
}

test('legacy schema used cascading deletes from plaid_items to accounts to transactions', () => {
  const initialSchema = readMigration('001_initial_schema.sql')

  assert.match(
    initialSchema,
    /plaid_item_id UUID REFERENCES plaid_items\(id\) ON DELETE CASCADE/i
  )
  assert.match(
    initialSchema,
    /account_id UUID REFERENCES accounts\(id\) ON DELETE CASCADE NOT NULL/i
  )
})

test('current safety migration removes hard-delete cascade path for account disconnect flows', () => {
  const migration = readMigration(
    '20260526100000_remove_legacy_delete_cascades_for_soft_deleted_transactions.sql'
  )

  assert.match(
    migration,
    /ALTER TABLE public\.transactions\s+DROP CONSTRAINT IF EXISTS transactions_account_id_fkey;/i
  )
  assert.match(
    migration,
    /ADD CONSTRAINT transactions_account_id_fkey\s+FOREIGN KEY \(account_id\)\s+REFERENCES public\.accounts\(id\)\s+ON DELETE RESTRICT;/i
  )
  assert.match(
    migration,
    /ALTER TABLE public\.accounts\s+DROP CONSTRAINT IF EXISTS accounts_plaid_item_id_fkey;/i
  )
  assert.match(
    migration,
    /ADD CONSTRAINT accounts_plaid_item_id_fkey\s+FOREIGN KEY \(plaid_item_id\)\s+REFERENCES public\.plaid_items\(id\)\s+ON DELETE SET NULL;/i
  )
})


test('split foundation guards direct transaction deletes so FK cascades would be unsafe', () => {
  const splitFoundation = readMigration('20260525090000_add_transaction_split_foundation.sql')

  assert.match(
    splitFoundation,
    /RAISE EXCEPTION 'transactions must be soft-deleted through supported routes'/i
  )
  assert.match(
    splitFoundation,
    /CREATE TRIGGER guard_transaction_split_writes_trigger\s+BEFORE INSERT OR UPDATE OR DELETE ON public\.transactions/i
  )
})
