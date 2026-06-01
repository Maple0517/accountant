CREATE OR REPLACE FUNCTION public.replace_transaction_split(
  p_transaction_id uuid,
  p_children jsonb,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  auth_user_id uuid := auth.uid();
  parent_id uuid;
  parent_row public.transactions%ROWTYPE;
  group_row public.transaction_split_groups%ROWTYPE;
  child jsonb;
  child_amount numeric;
  child_sum numeric := 0;
  child_count integer := 0;
  tolerance numeric := 0.01;
  child_id uuid;
  requested_child_ids uuid[] := ARRAY[]::uuid[];
  next_version integer;
  sequence_number integer := 0;
BEGIN
  IF auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user is required' USING ERRCODE = '42501';
  END IF;

  parent_id := public.resolve_split_parent_id(p_transaction_id);

  SELECT * INTO parent_row
  FROM public.transactions
  WHERE id = parent_id
  FOR UPDATE;

  IF NOT FOUND OR parent_row.user_id IS DISTINCT FROM auth_user_id THEN
    RAISE EXCEPTION 'Transaction not found' USING ERRCODE = '42501';
  END IF;

  IF parent_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted transaction cannot be split' USING ERRCODE = '22023';
  END IF;

  IF parent_row.split_role = 'child' THEN
    RAISE EXCEPTION 'Split child cannot be split directly' USING ERRCODE = '22023';
  END IF;

  IF parent_row.pending = true THEN
    RAISE EXCEPTION 'Pending transactions cannot be split in V1' USING ERRCODE = '22023';
  END IF;

  FOR child IN SELECT * FROM jsonb_array_elements(p_children)
  LOOP
    BEGIN
      child_amount := (child->>'amount_decimal')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid child amount' USING ERRCODE = '22023';
    END;

    child_sum := child_sum + child_amount;
    child_count := child_count + 1;

    IF child ? 'id' AND NULLIF(child->>'id', '') IS NOT NULL THEN
      child_id := (child->>'id')::uuid;
      requested_child_ids := requested_child_ids || child_id;

      IF NOT EXISTS (
        SELECT 1
        FROM public.transactions existing_child
        WHERE existing_child.id = child_id
          AND existing_child.user_id = auth_user_id
          AND existing_child.source = 'split'
          AND existing_child.split_parent_id = parent_row.id
          AND (
            existing_child.split_group_id = parent_row.split_group_id
            OR parent_row.split_group_id IS NULL
          )
      ) THEN
        RAISE EXCEPTION 'Invalid child reference' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF child ? 'category_id'
      AND NULLIF(child->>'category_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.categories
        WHERE id = (child->>'category_id')::uuid
          AND user_id = auth_user_id
      )
    THEN
      RAISE EXCEPTION 'Invalid child category' USING ERRCODE = '22023';
    END IF;

    IF child ? 'linked_transaction_id'
      AND NULLIF(child->>'linked_transaction_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.transactions
        WHERE id = (child->>'linked_transaction_id')::uuid
          AND user_id = auth_user_id
      )
    THEN
      RAISE EXCEPTION 'Invalid linked transaction' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  tolerance := CASE
    WHEN COALESCE(parent_row.iso_currency_code, 'USD') = 'JPY' THEN 1
    ELSE 0.01
  END;

  IF abs(child_sum - parent_row.amount) > tolerance THEN
    RAISE EXCEPTION 'Split children must balance to parent amount' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO group_row
  FROM public.transaction_split_groups
  WHERE parent_transaction_id = parent_row.id
  FOR UPDATE;

  IF FOUND AND p_expected_version IS NOT NULL AND group_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'Stale split version' USING ERRCODE = '40001';
  END IF;

  next_version := COALESCE(group_row.version, 0) + 1;

  IF NOT FOUND THEN
    INSERT INTO public.transaction_split_groups (
      user_id,
      parent_transaction_id,
      status,
      parent_amount_snapshot,
      child_amount_sum,
      iso_currency_code,
      version,
      last_validated_at
    )
    VALUES (
      auth_user_id,
      parent_row.id,
      'balanced',
      parent_row.amount,
      child_sum,
      COALESCE(parent_row.iso_currency_code, 'USD'),
      1,
      now()
    )
    RETURNING * INTO group_row;
    next_version := 1;
  ELSE
    UPDATE public.transaction_split_groups
    SET
      status = 'balanced',
      parent_amount_snapshot = parent_row.amount,
      child_amount_sum = child_sum,
      iso_currency_code = COALESCE(parent_row.iso_currency_code, 'USD'),
      version = next_version,
      last_validated_at = now()
    WHERE id = group_row.id
    RETURNING * INTO group_row;
  END IF;

  PERFORM set_config('app.split_write_context', 'split_rpc', true);

  UPDATE public.transactions
  SET
    split_role = 'parent',
    split_group_id = group_row.id,
    split_parent_id = NULL,
    split_sequence = NULL,
    split_status = 'balanced',
    is_hidden_from_reports = true
  WHERE id = parent_row.id;

  FOR child IN SELECT * FROM jsonb_array_elements(p_children)
  LOOP
    sequence_number := sequence_number + 1;
    child_amount := (child->>'amount_decimal')::numeric;
    child_id := NULLIF(child->>'id', '')::uuid;

    IF child_id IS NULL THEN
      child_id := gen_random_uuid();
    END IF;

    INSERT INTO public.transactions (
      id,
      user_id,
      account_id,
      category_id,
      plaid_transaction_id,
      amount,
      iso_currency_code,
      date,
      authorized_date,
      merchant_name,
      description,
      payment_channel,
      pending,
      source,
      tags,
      notes,
      treatment,
      refund_source,
      linked_transaction_id,
      budget_effective_date,
      semantic_override_source,
      split_group_id,
      split_parent_id,
      split_role,
      split_sequence,
      split_status,
      is_hidden_from_reports,
      deleted_at,
      deleted_reason
    )
    VALUES (
      child_id,
      auth_user_id,
      parent_row.account_id,
      NULLIF(child->>'category_id', '')::uuid,
      NULL,
      child_amount,
      COALESCE(parent_row.iso_currency_code, 'USD'),
      parent_row.date,
      parent_row.authorized_date,
      COALESCE(NULLIF(child->>'merchant_name', ''), parent_row.merchant_name),
      COALESCE(NULLIF(child->>'description', ''), parent_row.description),
      parent_row.payment_channel,
      parent_row.pending,
      'split',
      parent_row.tags,
      NULLIF(child->>'notes', ''),
      COALESCE(NULLIF(child->>'treatment', ''), 'spending'),
      NULLIF(child->>'refund_source', ''),
      NULLIF(child->>'linked_transaction_id', '')::uuid,
      COALESCE(NULLIF(child->>'allocation_date', '')::date, parent_row.date),
      'user',
      group_row.id,
      parent_row.id,
      'child',
      sequence_number,
      'balanced',
      false,
      NULL,
      NULL
    )
    ON CONFLICT (id) DO UPDATE
    SET
      category_id = EXCLUDED.category_id,
      amount = EXCLUDED.amount,
      merchant_name = EXCLUDED.merchant_name,
      description = EXCLUDED.description,
      notes = EXCLUDED.notes,
      treatment = EXCLUDED.treatment,
      refund_source = EXCLUDED.refund_source,
      linked_transaction_id = EXCLUDED.linked_transaction_id,
      budget_effective_date = EXCLUDED.budget_effective_date,
      split_sequence = EXCLUDED.split_sequence,
      split_status = EXCLUDED.split_status,
      deleted_at = NULL,
      deleted_reason = NULL,
      is_hidden_from_reports = false;

    requested_child_ids := requested_child_ids || child_id;
  END LOOP;

  UPDATE public.transactions
  SET
    deleted_at = now(),
    deleted_reason = 'split_replaced',
    is_hidden_from_reports = true,
    split_status = 'restored'
  WHERE split_group_id = group_row.id
    AND split_role = 'child'
    AND deleted_at IS NULL
    AND NOT (id = ANY(requested_child_ids));

  INSERT INTO public.transaction_split_events (
    user_id,
    split_group_id,
    parent_transaction_id,
    event_type,
    payload
  )
  VALUES (
    auth_user_id,
    group_row.id,
    parent_row.id,
    CASE WHEN next_version = 1 THEN 'created' ELSE 'replaced' END,
    jsonb_build_object(
      'version', next_version,
      'parent_amount', parent_row.amount::text,
      'child_sum', child_sum::text,
      'child_count', child_count
    )
  );

  RETURN jsonb_build_object(
    'parent', (
      SELECT to_jsonb(t)
      FROM public.transactions t
      WHERE t.id = parent_row.id
    ),
    'group', (
      SELECT to_jsonb(g)
      FROM public.transaction_split_groups g
      WHERE g.id = group_row.id
    ),
    'children', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.split_sequence), '[]'::jsonb)
      FROM public.transactions c
      WHERE c.split_group_id = group_row.id
        AND c.split_role = 'child'
        AND c.deleted_at IS NULL
    )
  );
END;
$$;
