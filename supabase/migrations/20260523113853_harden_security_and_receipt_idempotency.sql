-- Harden direct client access, add idempotency and ownership constraints.
-- This migration is intentionally additive/guarded for existing deployments.

-- Receipt idempotency for iOS Shortcut and retry-safe uploads.
ALTER TABLE public.receipts
ADD COLUMN IF NOT EXISTS idempotency_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS receipts_user_idempotency_key_uidx
  ON public.receipts(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Prevent duplicate category and account rows from concurrent requests.
CREATE UNIQUE INDEX IF NOT EXISTS categories_user_lower_name_uidx
  ON public.categories(user_id, lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_plaid_account_uidx
  ON public.accounts(user_id, plaid_item_id, plaid_account_id)
  WHERE plaid_account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_ios_capture_user_uidx
  ON public.accounts(user_id)
  WHERE is_manual IS TRUE AND name = 'iOS Capture';

-- Confidence fields are intentionally mixed-scale today: refund 0..1, transfer 0..100.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_refund_match_confidence_range_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_refund_match_confidence_range_check
    CHECK (refund_match_confidence IS NULL OR refund_match_confidence BETWEEN 0 AND 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_transfer_match_confidence_range_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_transfer_match_confidence_range_check
    CHECK (transfer_match_confidence IS NULL OR transfer_match_confidence BETWEEN 0 AND 100);
  END IF;
END $$;

-- Composite keys used by ownership-preserving foreign keys.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_id_user_id_unique'
      AND conrelid = 'public.accounts'::regclass
  ) THEN
    ALTER TABLE public.accounts
    ADD CONSTRAINT accounts_id_user_id_unique UNIQUE (id, user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'categories_id_user_id_unique'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
    ADD CONSTRAINT categories_id_user_id_unique UNIQUE (id, user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_id_user_id_unique'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_id_user_id_unique UNIQUE (id, user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_classification_jobs_id_user_id_unique'
      AND conrelid = 'public.ai_classification_jobs'::regclass
  ) THEN
    ALTER TABLE public.ai_classification_jobs
    ADD CONSTRAINT ai_classification_jobs_id_user_id_unique UNIQUE (id, user_id);
  END IF;
END $$;

-- Foreign keys that guarantee referenced rows belong to the same user. The old
-- single-column FKs are left in place so their original ON DELETE actions remain
-- authoritative; these composite FKs are additional ownership guards.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_account_user_fkey'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_account_user_fkey
    FOREIGN KEY (account_id, user_id)
    REFERENCES public.accounts(id, user_id)
    ON DELETE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_category_user_fkey'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_category_user_fkey
    FOREIGN KEY (category_id, user_id)
    REFERENCES public.categories(id, user_id)
    ON DELETE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_linked_transaction_user_fkey'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_linked_transaction_user_fkey
    FOREIGN KEY (linked_transaction_id, user_id)
    REFERENCES public.transactions(id, user_id)
    ON DELETE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'budgets_category_user_fkey'
      AND conrelid = 'public.budgets'::regclass
  ) THEN
    ALTER TABLE public.budgets
    ADD CONSTRAINT budgets_category_user_fkey
    FOREIGN KEY (category_id, user_id)
    REFERENCES public.categories(id, user_id)
    ON DELETE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_job_items_job_user_fkey'
      AND conrelid = 'public.ai_classification_job_items'::regclass
  ) THEN
    ALTER TABLE public.ai_classification_job_items
    ADD CONSTRAINT ai_job_items_job_user_fkey
    FOREIGN KEY (job_id, user_id)
    REFERENCES public.ai_classification_jobs(id, user_id)
    ON DELETE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_job_items_transaction_user_fkey'
      AND conrelid = 'public.ai_classification_job_items'::regclass
  ) THEN
    ALTER TABLE public.ai_classification_job_items
    ADD CONSTRAINT ai_job_items_transaction_user_fkey
    FOREIGN KEY (transaction_id, user_id)
    REFERENCES public.transactions(id, user_id)
    ON DELETE NO ACTION;
  END IF;
END $$;

-- RLS ownership guard policies for cross-table references. These protect direct
-- browser/Data API writes even before the composite FKs are exercised.
DROP POLICY IF EXISTS "accounts_all" ON public.accounts;
CREATE POLICY "accounts_all" ON public.accounts FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      plaid_item_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.plaid_items pi
        WHERE pi.id = accounts.plaid_item_id
          AND pi.user_id = accounts.user_id
      )
    )
  );

DROP POLICY IF EXISTS "transactions_all" ON public.transactions;
CREATE POLICY "transactions_all" ON public.transactions FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.id = transactions.account_id
        AND a.user_id = transactions.user_id
    )
    AND (
      category_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.categories c
        WHERE c.id = transactions.category_id
          AND c.user_id = transactions.user_id
      )
    )
    AND (
      linked_transaction_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.transactions linked
        WHERE linked.id = transactions.linked_transaction_id
          AND linked.user_id = transactions.user_id
      )
    )
  );

DROP POLICY IF EXISTS "budgets_all" ON public.budgets;
CREATE POLICY "budgets_all" ON public.budgets FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.id = budgets.category_id
        AND c.user_id = budgets.user_id
    )
  );

DROP POLICY IF EXISTS "ai_classification_job_items_all" ON public.ai_classification_job_items;
CREATE POLICY "ai_classification_job_items_all" ON public.ai_classification_job_items FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1
      FROM public.ai_classification_jobs j
      WHERE j.id = ai_classification_job_items.job_id
        AND j.user_id = ai_classification_job_items.user_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.transactions t
      WHERE t.id = ai_classification_job_items.transaction_id
        AND t.user_id = ai_classification_job_items.user_id
    )
  );

-- Limit direct Data API exposure for server-managed tables with sensitive or service-only data.
-- The app's route handlers use the service role for these writes/reads.
REVOKE SELECT, INSERT, UPDATE ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, display_name, default_currency, notion_sync_enabled, notion_database_id, created_at, updated_at) ON public.profiles TO anon, authenticated;
GRANT INSERT (id, display_name, default_currency, notion_sync_enabled, notion_database_id, created_at, updated_at) ON public.profiles TO anon, authenticated;
GRANT UPDATE (display_name, default_currency, notion_sync_enabled, notion_database_id, updated_at) ON public.profiles TO anon, authenticated;
GRANT SELECT (id, user_id, institution_name, institution_id, status, error_code, last_synced_at, last_sync_error, created_at, updated_at) ON public.plaid_items TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.plaid_items FROM anon, authenticated;
REVOKE ALL ON public.api_keys FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ai_classification_jobs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ai_classification_job_items FROM anon, authenticated;

COMMENT ON TABLE public.api_keys IS 'Stores hashed iOS Shortcut API keys. Direct anon/auth access is revoked; managed only through service-role route handlers.';
COMMENT ON COLUMN public.receipts.idempotency_key IS 'Optional caller-provided key used to make receipt uploads retry-safe per user.';
COMMENT ON COLUMN public.profiles.notion_token IS 'Sensitive Notion integration token. Direct anon/auth access is revoked; read and write through server route handlers only.';
COMMENT ON COLUMN public.plaid_items.access_token IS 'Sensitive Plaid access token. Direct anon/auth column access is not granted; server/service-role only.';

-- Harden database functions by fixing search_path and removing direct RPC execution where safe.
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_catalog;
ALTER FUNCTION public.handle_new_user() SET search_path = public, auth;
ALTER FUNCTION public.rls_auto_enable() SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
