-- ============================================================
-- AI classification queue for Plaid transactions
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_classification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  total_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ai_classification_job_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES ai_classification_jobs(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (job_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_created
  ON ai_classification_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_job_items_job_status
  ON ai_classification_job_items(job_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_job_items_transaction
  ON ai_classification_job_items(transaction_id);

ALTER TABLE ai_classification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_classification_job_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_classification_jobs'
      AND policyname = 'ai_classification_jobs_all'
  ) THEN
    CREATE POLICY "ai_classification_jobs_all" ON ai_classification_jobs FOR ALL
      USING ((SELECT auth.uid()) = user_id)
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_classification_job_items'
      AND policyname = 'ai_classification_job_items_all'
  ) THEN
    CREATE POLICY "ai_classification_job_items_all" ON ai_classification_job_items FOR ALL
      USING ((SELECT auth.uid()) = user_id)
      WITH CHECK ((SELECT auth.uid()) = user_id);
  END IF;
END $$;
