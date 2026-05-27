-- ============================================================
-- Transaction split foundation
-- ============================================================
-- Adds soft-delete/report visibility fields, split schema guardrails,
-- generated effective_date, and read-only RLS for split audit tables.
-- Split child rows are still created only by future RPCs.

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_source_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_source_check
  CHECK (source IN ('plaid', 'manual', 'receipt', 'split'));

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason text NULL,
  ADD COLUMN IF NOT EXISTS is_hidden_from_reports boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS split_group_id uuid NULL,
  ADD COLUMN IF NOT EXISTS split_parent_id uuid NULL,
  ADD COLUMN IF NOT EXISTS split_role text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS split_sequence integer NULL,
  ADD COLUMN IF NOT EXISTS split_status text NULL,
  ADD COLUMN IF NOT EXISTS effective_date date
    GENERATED ALWAYS AS (COALESCE(budget_effective_date, date)) STORED;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_split_role_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_split_role_check
  CHECK (split_role IN ('none', 'parent', 'child'));

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_split_status_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_split_status_check
  CHECK (
    split_status IS NULL OR
    split_status IN ('balanced', 'out_of_balance', 'draft', 'restored', 'orphaned')
  );

CREATE TABLE IF NOT EXISTS public.transaction_split_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'balanced',
  parent_amount_snapshot numeric NOT NULL,
  child_amount_sum numeric NOT NULL DEFAULT 0,
  iso_currency_code text NOT NULL DEFAULT 'USD',
  version integer NOT NULL DEFAULT 1,
  last_validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transaction_split_groups_status_check
    CHECK (status IN ('balanced', 'out_of_balance', 'draft', 'restored', 'orphaned')),
  CONSTRAINT transaction_split_groups_parent_unique UNIQUE (parent_transaction_id)
);

CREATE TABLE IF NOT EXISTS public.transaction_split_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  split_group_id uuid REFERENCES public.transaction_split_groups(id) ON DELETE CASCADE,
  parent_transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transaction_split_events_type_check
    CHECK (event_type IN (
      'created',
      'replaced',
      'restored',
      'out_of_balance',
      'balanced_again',
      'plaid_removed',
      'plaid_modified',
      'plaid_pending_replaced',
      'child_deleted',
      'notion_parent_hidden',
      'notion_parent_archived',
      'notion_child_archived',
      'soft_deleted',
      'purged'
    ))
);

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_split_group_id_fkey;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_split_group_id_fkey
  FOREIGN KEY (split_group_id)
  REFERENCES public.transaction_split_groups(id)
  ON DELETE RESTRICT;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_split_parent_id_fkey;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_split_parent_id_fkey
  FOREIGN KEY (split_parent_id)
  REFERENCES public.transactions(id)
  ON DELETE RESTRICT;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_split_child_shape_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_split_child_shape_check
  CHECK (
    split_role <> 'child'
    OR (
      source = 'split'
      AND plaid_transaction_id IS NULL
      AND split_parent_id IS NOT NULL
      AND split_group_id IS NOT NULL
      AND split_sequence IS NOT NULL
      AND (
        (deleted_at IS NULL AND is_hidden_from_reports = false)
        OR
        (deleted_at IS NOT NULL AND is_hidden_from_reports = true)
      )
    )
  );

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_split_parent_shape_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_split_parent_shape_check
  CHECK (
    split_role <> 'parent'
    OR (
      split_parent_id IS NULL
      AND split_sequence IS NULL
      AND split_group_id IS NOT NULL
      AND is_hidden_from_reports = true
    )
  );

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_split_none_shape_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_split_none_shape_check
  CHECK (
    split_role <> 'none'
    OR (
      split_group_id IS NULL
      AND split_parent_id IS NULL
      AND split_sequence IS NULL
      AND split_status IS NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS transactions_active_split_sequence_unique
  ON public.transactions(split_group_id, split_sequence)
  WHERE split_role = 'child' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS transactions_user_effective_visible_idx
  ON public.transactions(user_id, effective_date DESC)
  WHERE deleted_at IS NULL AND is_hidden_from_reports = false;

CREATE INDEX IF NOT EXISTS transactions_user_split_role_idx
  ON public.transactions(user_id, split_role);

CREATE INDEX IF NOT EXISTS transactions_split_group_id_idx
  ON public.transactions(split_group_id)
  WHERE split_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_split_parent_id_idx
  ON public.transactions(split_parent_id)
  WHERE split_parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_user_hidden_reports_idx
  ON public.transactions(user_id, is_hidden_from_reports);

CREATE INDEX IF NOT EXISTS transactions_user_deleted_at_idx
  ON public.transactions(user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS transaction_split_groups_user_id_idx
  ON public.transaction_split_groups(user_id);

CREATE INDEX IF NOT EXISTS transaction_split_groups_parent_transaction_id_idx
  ON public.transaction_split_groups(parent_transaction_id);

CREATE INDEX IF NOT EXISTS transaction_split_groups_user_status_idx
  ON public.transaction_split_groups(user_id, status);

CREATE OR REPLACE FUNCTION public.guard_transaction_split_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  split_context text := current_setting('app.split_write_context', true);
BEGIN
  IF split_context IN ('split_rpc', 'trusted_sync') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.source = 'split'
      OR NEW.split_role <> 'none'
      OR NEW.split_group_id IS NOT NULL
      OR NEW.split_parent_id IS NOT NULL
      OR NEW.split_sequence IS NOT NULL
      OR NEW.split_status IS NOT NULL
      OR NEW.deleted_at IS NOT NULL
      OR NEW.deleted_reason IS NOT NULL
      OR NEW.is_hidden_from_reports = true
    THEN
      RAISE EXCEPTION 'split/protected transaction fields require split write context'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.split_role <> 'none'
      OR OLD.source = 'split'
      OR OLD.split_group_id IS NOT NULL
      OR OLD.split_parent_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'split transactions cannot be deleted directly'
        USING ERRCODE = '42501';
    END IF;

    RAISE EXCEPTION 'transactions must be soft-deleted through supported routes'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id
      OR OLD.account_id IS DISTINCT FROM NEW.account_id
      OR OLD.amount IS DISTINCT FROM NEW.amount
      OR OLD.date IS DISTINCT FROM NEW.date
      OR OLD.source IS DISTINCT FROM NEW.source
      OR OLD.plaid_transaction_id IS DISTINCT FROM NEW.plaid_transaction_id
      OR OLD.split_group_id IS DISTINCT FROM NEW.split_group_id
      OR OLD.split_parent_id IS DISTINCT FROM NEW.split_parent_id
      OR OLD.split_role IS DISTINCT FROM NEW.split_role
      OR OLD.split_sequence IS DISTINCT FROM NEW.split_sequence
      OR OLD.split_status IS DISTINCT FROM NEW.split_status
      OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
      OR OLD.deleted_reason IS DISTINCT FROM NEW.deleted_reason
      OR OLD.is_hidden_from_reports IS DISTINCT FROM NEW.is_hidden_from_reports
    THEN
      RAISE EXCEPTION 'protected transaction fields require split write context'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'deleted transactions cannot be edited directly'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.split_role = 'parent' THEN
      RAISE EXCEPTION 'split parent transactions cannot be edited directly'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS guard_transaction_split_writes_trigger ON public.transactions;
CREATE TRIGGER guard_transaction_split_writes_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_transaction_split_writes();

CREATE OR REPLACE FUNCTION public.soft_delete_transactions_for_trusted_sync(
  p_user_id uuid,
  p_transaction_ids uuid[] DEFAULT NULL,
  p_plaid_transaction_ids text[] DEFAULT NULL,
  p_deleted_reason text DEFAULT 'trusted_sync_soft_delete'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_count integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(array_length(p_transaction_ids, 1), 0) = 0
    AND COALESCE(array_length(p_plaid_transaction_ids, 1), 0) = 0
  THEN
    RETURN 0;
  END IF;

  PERFORM set_config('app.split_write_context', 'trusted_sync', true);

  UPDATE public.transactions
  SET
    deleted_at = COALESCE(deleted_at, now()),
    deleted_reason = p_deleted_reason,
    is_hidden_from_reports = true
  WHERE user_id = p_user_id
    AND (
      (p_transaction_ids IS NOT NULL AND id = ANY(p_transaction_ids))
      OR
      (
        p_plaid_transaction_ids IS NOT NULL
        AND plaid_transaction_id = ANY(p_plaid_transaction_ids)
      )
    );

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_transaction_split_writes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_transactions_for_trusted_sync(
  uuid,
  uuid[],
  text[],
  text
) FROM PUBLIC;

ALTER TABLE public.transaction_split_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_split_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own split groups" ON public.transaction_split_groups;
CREATE POLICY "Users can view their own split groups"
  ON public.transaction_split_groups
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own split events" ON public.transaction_split_events;
CREATE POLICY "Users can view their own split events"
  ON public.transaction_split_events
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

GRANT SELECT ON public.transaction_split_groups TO authenticated;
GRANT SELECT ON public.transaction_split_events TO authenticated;

CREATE OR REPLACE TRIGGER transaction_split_groups_updated_at
  BEFORE UPDATE ON public.transaction_split_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
