-- ============================================================
-- Remove legacy hard-delete cascades that conflict with transaction soft-delete
-- ============================================================
-- Transactions are now protected by soft-delete-only semantics. The original
-- FK cascade chain (`plaid_items -> accounts -> transactions`) can still
-- attempt physical deletes and trigger `guard_transaction_split_writes()`.
--
-- Align FK behavior with current application semantics:
-- - deleting a Plaid item should not physically delete linked accounts;
--   the app explicitly nulls plaid linkage when preserving/disconnecting.
-- - deleting an account with historical transactions should be blocked unless
--   a dedicated archival/soft-delete flow is introduced.

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_account_id_fkey;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_account_id_fkey
  FOREIGN KEY (account_id)
  REFERENCES public.accounts(id)
  ON DELETE RESTRICT;

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_plaid_item_id_fkey;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_plaid_item_id_fkey
  FOREIGN KEY (plaid_item_id)
  REFERENCES public.plaid_items(id)
  ON DELETE SET NULL;
