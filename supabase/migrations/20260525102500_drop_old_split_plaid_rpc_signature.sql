-- Drop the pre-pending_transaction_id overload to avoid Supabase RPC ambiguity.

DROP FUNCTION IF EXISTS public.apply_plaid_update_to_split_parent_for_trusted_sync(
  uuid,
  text,
  numeric,
  date,
  date,
  text,
  text,
  text,
  boolean,
  text,
  text
);

DROP FUNCTION IF EXISTS public.apply_plaid_update_to_split_parent(
  uuid,
  text,
  numeric,
  date,
  date,
  text,
  text,
  text,
  boolean,
  text,
  text
);
