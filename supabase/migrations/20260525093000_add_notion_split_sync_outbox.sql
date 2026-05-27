-- ============================================================
-- Durable Notion split sync outbox
-- ============================================================
-- Used by split RPC/API flows to record retryable Notion side effects.

CREATE TABLE IF NOT EXISTS public.notion_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE CASCADE,
  split_group_id uuid REFERENCES public.transaction_split_groups(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notion_sync_outbox_job_type_check
    CHECK (job_type IN (
      'sync_effective_transaction',
      'mark_split_parent_hidden',
      'archive_or_mark_child_deleted',
      'sync_split_group',
      'restore_split_parent'
    )),

  CONSTRAINT notion_sync_outbox_status_check
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'dead')),

  CONSTRAINT notion_sync_outbox_idempotency_unique
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS notion_sync_outbox_user_status_available_idx
  ON public.notion_sync_outbox(user_id, status, available_at);

CREATE INDEX IF NOT EXISTS notion_sync_outbox_transaction_id_idx
  ON public.notion_sync_outbox(transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notion_sync_outbox_split_group_id_idx
  ON public.notion_sync_outbox(split_group_id)
  WHERE split_group_id IS NOT NULL;

ALTER TABLE public.notion_sync_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own Notion sync outbox" ON public.notion_sync_outbox;
CREATE POLICY "Users can view their own Notion sync outbox"
  ON public.notion_sync_outbox
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

GRANT SELECT ON public.notion_sync_outbox TO authenticated;

CREATE OR REPLACE TRIGGER notion_sync_outbox_updated_at
  BEFORE UPDATE ON public.notion_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

