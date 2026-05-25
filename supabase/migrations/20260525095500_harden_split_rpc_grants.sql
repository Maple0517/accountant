-- ============================================================
-- Harden split RPC grants
-- ============================================================

REVOKE ALL ON FUNCTION public.resolve_split_parent_id(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_transaction_split_group(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.replace_transaction_split(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_transaction_split(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.soft_delete_transactions_for_trusted_sync(uuid, uuid[], text[], text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.validate_transaction_split_group(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_transaction_split(uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_transaction_split(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_transactions_for_trusted_sync(uuid, uuid[], text[], text) TO service_role;

