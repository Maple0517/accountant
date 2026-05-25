-- ============================================================
-- Split Plaid hardening + Notion outbox writers
-- ============================================================

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
  p_event_type text DEFAULT 'plaid_modified'
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
  p_event_type text DEFAULT 'plaid_modified'
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
    p_event_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_notion_sync_outbox(
  p_user_id uuid,
  p_transaction_id uuid DEFAULT NULL,
  p_split_group_id uuid DEFAULT NULL,
  p_job_type text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_available_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_user_id uuid := auth.uid();
  outbox_id uuid;
BEGIN
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user is required' USING ERRCODE = '42501';
  END IF;

  IF auth_user_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Cannot enqueue Notion sync for another user' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.notion_sync_outbox (
    user_id,
    transaction_id,
    split_group_id,
    job_type,
    idempotency_key,
    available_at
  )
  VALUES (
    p_user_id,
    p_transaction_id,
    p_split_group_id,
    p_job_type,
    p_idempotency_key,
    COALESCE(p_available_at, now())
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET
    available_at = LEAST(public.notion_sync_outbox.available_at, EXCLUDED.available_at),
    updated_at = now()
  RETURNING id INTO outbox_id;

  RETURN outbox_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plaid_update_to_split_parent(uuid, text, numeric, date, date, text, text, text, boolean, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.apply_plaid_update_to_split_parent_for_trusted_sync(uuid, text, numeric, date, date, text, text, text, boolean, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_notion_sync_outbox(uuid, uuid, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.apply_plaid_update_to_split_parent_for_trusted_sync(uuid, text, numeric, date, date, text, text, text, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_notion_sync_outbox(uuid, uuid, uuid, text, text, timestamptz) TO authenticated;

