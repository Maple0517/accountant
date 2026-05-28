-- ============================================================
-- Backfill Plaid accounts disconnected before archive metadata
-- ============================================================
-- Accounts with no Plaid linkage, not manual, no active transactions, and
-- at least one transaction soft-deleted by the Plaid delete-history flow are
-- disconnected history and should not contribute cards or dashboard balances.

UPDATE public.accounts AS account
SET
  archived_at = COALESCE(deleted_history.last_deleted_at, now()),
  archived_reason = 'plaid_disconnect_delete_history'
FROM (
  SELECT
    transactions.account_id,
    max(transactions.deleted_at) AS last_deleted_at
  FROM public.transactions AS transactions
  GROUP BY transactions.account_id
  HAVING
    count(*) FILTER (WHERE transactions.deleted_at IS NULL) = 0
    AND count(*) FILTER (WHERE transactions.deleted_reason = 'plaid_disconnect_delete_history') > 0
) AS deleted_history
WHERE account.id = deleted_history.account_id
  AND account.archived_at IS NULL
  AND account.plaid_item_id IS NULL
  AND account.plaid_account_id IS NULL
  AND account.is_manual = false;
