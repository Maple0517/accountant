-- ============================================================
-- Add account archive metadata for Plaid delete-history flows
-- ============================================================
-- `preserve_history` keeps account cards visible after disconnecting Plaid.
-- `delete_history` should hide those cards while retaining account rows so
-- historical/soft-deleted transactions can keep their FK references.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_reason text NULL;

CREATE INDEX IF NOT EXISTS accounts_user_active_idx
  ON public.accounts(user_id, created_at DESC)
  WHERE archived_at IS NULL;
