-- Add canonical transaction treatment fields on top of legacy semantics.
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS treatment text NOT NULL DEFAULT 'spending',
ADD COLUMN IF NOT EXISTS refund_source text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_treatment_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_treatment_check
    CHECK (treatment IN ('spending', 'income', 'refund', 'transfer', 'excluded'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_refund_source_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_refund_source_check
    CHECK (refund_source IN ('merchant_refund', 'reimbursement'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_refund_source_treatment_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_refund_source_treatment_check
    CHECK (refund_source IS NULL OR treatment = 'refund');
  END IF;
END $$;

SELECT set_config('app.split_write_context', 'trusted_sync', true);

WITH resolved AS (
  SELECT
    t.id,
    CASE
      WHEN t.transaction_kind IN ('refund', 'reimbursement') THEN 'refund'
      WHEN t.transaction_kind = 'transfer' OR t.budget_behavior = 'exclude_as_transfer' THEN 'transfer'
      WHEN t.budget_behavior = 'exclude_manual' THEN 'excluded'
      WHEN t.budget_behavior = 'count_as_income' THEN 'income'
      ELSE 'spending'
    END AS next_treatment,
    CASE
      WHEN t.transaction_kind = 'reimbursement' THEN 'reimbursement'
      WHEN t.transaction_kind = 'refund' THEN 'merchant_refund'
      ELSE NULL
    END AS next_refund_source
  FROM public.transactions t
)
UPDATE public.transactions t
SET
  treatment = resolved.next_treatment,
  refund_source = resolved.next_refund_source
FROM resolved
WHERE t.id = resolved.id;

CREATE INDEX IF NOT EXISTS transactions_user_treatment_idx
ON public.transactions(user_id, treatment);

CREATE INDEX IF NOT EXISTS transactions_user_treatment_date_idx
ON public.transactions(user_id, treatment, date DESC);

CREATE INDEX IF NOT EXISTS transactions_refund_source_idx
ON public.transactions(refund_source)
WHERE refund_source IS NOT NULL;
