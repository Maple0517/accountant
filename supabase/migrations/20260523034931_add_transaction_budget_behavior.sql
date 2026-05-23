-- Add transaction-level budget and transfer semantics.
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS budget_behavior text NULL,
ADD COLUMN IF NOT EXISTS transfer_group_id uuid NULL,
ADD COLUMN IF NOT EXISTS transfer_match_status text NULL,
ADD COLUMN IF NOT EXISTS transfer_match_confidence numeric NULL,
ADD COLUMN IF NOT EXISTS transfer_match_reason text NULL,
ADD COLUMN IF NOT EXISTS semantic_override_source text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_budget_behavior_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_budget_behavior_check
    CHECK (
      budget_behavior IN (
        'count_as_spending',
        'count_as_income',
        'exclude_as_transfer',
        'exclude_manual'
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_transfer_match_status_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_transfer_match_status_check
    CHECK (
      transfer_match_status IN (
        'unmatched',
        'auto_matched',
        'suggested',
        'manually_matched',
        'ignored'
      )
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_semantic_override_source_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_semantic_override_source_check
    CHECK (semantic_override_source IN ('system', 'user', 'rule', 'ai'));
  END IF;
END $$;

WITH resolved AS (
  SELECT
    t.id,
    CASE
      WHEN t.transaction_kind = 'transfer' THEN 'exclude_as_transfer'
      WHEN t.transaction_kind IN ('refund', 'reimbursement') THEN 'count_as_spending'
      WHEN c.is_excluded_from_budget IS TRUE AND c.type = 'transfer' THEN 'exclude_as_transfer'
      WHEN c.is_excluded_from_budget IS TRUE THEN 'exclude_manual'
      WHEN c.type = 'income' THEN 'count_as_income'
      WHEN c.type = 'transfer' THEN 'exclude_as_transfer'
      ELSE 'count_as_spending'
    END AS next_budget_behavior
  FROM public.transactions t
  LEFT JOIN public.categories c ON c.id = t.category_id
  WHERE t.budget_behavior IS NULL
)
UPDATE public.transactions t
SET
  budget_behavior = resolved.next_budget_behavior,
  semantic_override_source = COALESCE(t.semantic_override_source, 'system')
FROM resolved
WHERE t.id = resolved.id;

CREATE INDEX IF NOT EXISTS transactions_user_budget_behavior_idx
ON public.transactions(user_id, budget_behavior);

CREATE INDEX IF NOT EXISTS transactions_transfer_group_id_idx
ON public.transactions(transfer_group_id)
WHERE transfer_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_user_transfer_match_status_idx
ON public.transactions(user_id, transfer_match_status)
WHERE transfer_match_status IS NOT NULL;
