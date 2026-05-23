-- Add lightweight refund / reimbursement metadata to transactions.
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS transaction_kind text NOT NULL DEFAULT 'normal',
ADD COLUMN IF NOT EXISTS linked_transaction_id uuid NULL,
ADD COLUMN IF NOT EXISTS budget_effective_date date NULL,
ADD COLUMN IF NOT EXISTS refund_match_confidence numeric NULL,
ADD COLUMN IF NOT EXISTS refund_match_reason text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_transaction_kind_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_transaction_kind_check
    CHECK (transaction_kind IN ('normal', 'refund', 'reimbursement', 'transfer'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_linked_transaction_id_fkey'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_linked_transaction_id_fkey
    FOREIGN KEY (linked_transaction_id)
    REFERENCES public.transactions(id)
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS transactions_user_kind_idx
ON public.transactions(user_id, transaction_kind);

CREATE INDEX IF NOT EXISTS transactions_user_budget_effective_date_idx
ON public.transactions(user_id, budget_effective_date);

CREATE INDEX IF NOT EXISTS transactions_linked_transaction_id_idx
ON public.transactions(linked_transaction_id);

UPDATE public.transactions
SET budget_effective_date = date
WHERE budget_effective_date IS NULL;
