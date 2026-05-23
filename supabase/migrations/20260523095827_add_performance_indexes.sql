-- Performance indexes suggested by profiling and Supabase advisors.
-- Avoid CONCURRENTLY here so the migration remains compatible with transactional runners.

CREATE INDEX IF NOT EXISTS idx_accounts_plaid_item_id
  ON public.accounts(plaid_item_id);

CREATE INDEX IF NOT EXISTS idx_ai_job_items_user
  ON public.ai_classification_job_items(user_id);

CREATE INDEX IF NOT EXISTS idx_budgets_category
  ON public.budgets(category_id);

CREATE INDEX IF NOT EXISTS accounts_ios_capture_lookup_idx
  ON public.accounts(user_id, name)
  WHERE is_manual IS TRUE;

CREATE INDEX IF NOT EXISTS plaid_items_active_sync_idx
  ON public.plaid_items(id, user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS transactions_unsynced_notion_user_date_idx
  ON public.transactions(user_id, date DESC)
  WHERE notion_page_id IS NULL;

CREATE INDEX IF NOT EXISTS transactions_refund_match_candidates_idx
  ON public.transactions(user_id, transaction_kind, date DESC)
  WHERE amount > 0;

CREATE INDEX IF NOT EXISTS transactions_uncategorized_plaid_account_idx
  ON public.transactions(user_id, account_id)
  WHERE source = 'plaid' AND category_id IS NULL;
