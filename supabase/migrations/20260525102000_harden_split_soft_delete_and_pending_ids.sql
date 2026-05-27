-- ============================================================
-- Split soft-delete hardening + Plaid pending replacement ids
-- ============================================================

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS pending_transaction_id text NULL;

CREATE INDEX IF NOT EXISTS transactions_pending_transaction_id_idx
  ON public.transactions(user_id, pending_transaction_id)
  WHERE pending_transaction_id IS NOT NULL;

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
  parent_record record;
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

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.trusted_sync_soft_delete_targets (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.trusted_sync_soft_delete_targets;

  INSERT INTO pg_temp.trusted_sync_soft_delete_targets (id)
  SELECT id
  FROM public.transactions
  WHERE user_id = p_user_id
    AND (
      (p_transaction_ids IS NOT NULL AND id = ANY(p_transaction_ids))
      OR
      (
        p_plaid_transaction_ids IS NOT NULL
        AND plaid_transaction_id = ANY(p_plaid_transaction_ids)
      )
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO pg_temp.trusted_sync_soft_delete_targets (id)
  SELECT child.id
  FROM public.transactions parent
  JOIN public.transactions child
    ON child.split_group_id = parent.split_group_id
   AND child.split_role = 'child'
   AND child.deleted_at IS NULL
  JOIN pg_temp.trusted_sync_soft_delete_targets target
    ON target.id = parent.id
  WHERE parent.user_id = p_user_id
    AND parent.split_role = 'parent'
  ON CONFLICT DO NOTHING;

  UPDATE public.transactions
  SET
    deleted_at = COALESCE(deleted_at, now()),
    deleted_reason = CASE
      WHEN split_role = 'child' AND p_deleted_reason = 'plaid_removed'
        THEN 'parent_plaid_removed'
      ELSE p_deleted_reason
    END,
    is_hidden_from_reports = true,
    split_status = CASE
      WHEN split_role IN ('parent', 'child') THEN 'orphaned'
      ELSE split_status
    END
  WHERE user_id = p_user_id
    AND id IN (SELECT id FROM pg_temp.trusted_sync_soft_delete_targets);

  GET DIAGNOSTICS affected_count = ROW_COUNT;

  FOR parent_record IN
    SELECT DISTINCT
      parent.user_id,
      parent.id AS parent_transaction_id,
      parent.split_group_id
    FROM public.transactions parent
    JOIN pg_temp.trusted_sync_soft_delete_targets target
      ON target.id = parent.id
    WHERE parent.user_id = p_user_id
      AND parent.split_role = 'parent'
      AND parent.split_group_id IS NOT NULL
  LOOP
    UPDATE public.transaction_split_groups
    SET
      status = 'orphaned',
      last_validated_at = now()
    WHERE id = parent_record.split_group_id;

    INSERT INTO public.transaction_split_events (
      user_id,
      split_group_id,
      parent_transaction_id,
      event_type,
      payload
    )
    VALUES (
      parent_record.user_id,
      parent_record.split_group_id,
      parent_record.parent_transaction_id,
      'plaid_removed',
      jsonb_build_object('deleted_reason', p_deleted_reason)
    );
  END LOOP;

  RETURN affected_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_plaid_update_to_split_parent(
  p_parent_transaction_id uuid,
  p_plaid_transaction_id text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_date date DEFAULT NULL,
  p_authorized_date date DEFAULT NULL,
  p_merchant_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_payment_channel text DEFAULT NULL,
  p_pending boolean DEFAULT NULL,
  p_iso_currency_code text DEFAULT NULL,
  p_event_type text DEFAULT 'plaid_modified',
  p_pending_transaction_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_row public.transactions%ROWTYPE;
  validation_result jsonb;
BEGIN
  IF current_setting('app.split_write_context', true) <> 'trusted_sync' THEN
    RAISE EXCEPTION 'trusted sync context is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO parent_row
  FROM public.transactions
  WHERE id = p_parent_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Split parent not found' USING ERRCODE = 'P0002';
  END IF;

  IF parent_row.split_role <> 'parent' THEN
    RAISE EXCEPTION 'Transaction is not a split parent' USING ERRCODE = '22023';
  END IF;

  UPDATE public.transactions
  SET
    plaid_transaction_id = COALESCE(p_plaid_transaction_id, plaid_transaction_id),
    pending_transaction_id = CASE
      WHEN p_plaid_transaction_id IS NOT NULL
        AND p_plaid_transaction_id IS DISTINCT FROM parent_row.plaid_transaction_id
        THEN parent_row.plaid_transaction_id
      ELSE p_pending_transaction_id
    END,
    amount = COALESCE(p_amount, amount),
    date = COALESCE(p_date, date),
    authorized_date = p_authorized_date,
    merchant_name = p_merchant_name,
    description = COALESCE(p_description, description),
    payment_channel = p_payment_channel,
    pending = COALESCE(p_pending, pending),
    iso_currency_code = COALESCE(p_iso_currency_code, iso_currency_code)
  WHERE id = parent_row.id
  RETURNING * INTO parent_row;

  validation_result := public.validate_transaction_split_group(
    parent_row.split_group_id,
    true
  );

  INSERT INTO public.transaction_split_events (
    user_id,
    split_group_id,
    parent_transaction_id,
    event_type,
    payload
  )
  VALUES (
    parent_row.user_id,
    parent_row.split_group_id,
    parent_row.id,
    p_event_type,
    jsonb_build_object(
      'plaid_transaction_id', parent_row.plaid_transaction_id,
      'pending_transaction_id', parent_row.pending_transaction_id,
      'amount', parent_row.amount::text,
      'date', parent_row.date::text,
      'pending', parent_row.pending,
      'validation', validation_result
    )
  );

  RETURN jsonb_build_object(
    'parent', to_jsonb(parent_row),
    'validation', validation_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_plaid_update_to_split_parent_for_trusted_sync(
  p_parent_transaction_id uuid,
  p_plaid_transaction_id text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_date date DEFAULT NULL,
  p_authorized_date date DEFAULT NULL,
  p_merchant_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_payment_channel text DEFAULT NULL,
  p_pending boolean DEFAULT NULL,
  p_iso_currency_code text DEFAULT NULL,
  p_event_type text DEFAULT 'plaid_modified',
  p_pending_transaction_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.split_write_context', 'trusted_sync', true);

  RETURN public.apply_plaid_update_to_split_parent(
    p_parent_transaction_id,
    p_plaid_transaction_id,
    p_amount,
    p_date,
    p_authorized_date,
    p_merchant_name,
    p_description,
    p_payment_channel,
    p_pending,
    p_iso_currency_code,
    p_event_type,
    p_pending_transaction_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plaid_update_to_split_parent(uuid, text, numeric, date, date, text, text, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_plaid_update_to_split_parent_for_trusted_sync(uuid, text, numeric, date, date, text, text, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.apply_plaid_update_to_split_parent_for_trusted_sync(uuid, text, numeric, date, date, text, text, text, boolean, text, text, text) TO service_role;
