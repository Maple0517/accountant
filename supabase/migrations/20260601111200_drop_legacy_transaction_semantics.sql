DROP INDEX IF EXISTS public.transactions_user_transaction_kind_date_idx;
DROP INDEX IF EXISTS public.transactions_user_budget_behavior_idx;
DROP INDEX IF EXISTS public.transactions_user_treatment_idx;
DROP INDEX IF EXISTS public.transactions_user_treatment_date_idx;
DROP INDEX IF EXISTS public.transactions_refund_source_idx;
DROP INDEX IF EXISTS public.transactions_user_transaction_kind_idx;

ALTER TABLE public.transactions
DROP CONSTRAINT IF EXISTS transactions_transaction_kind_check;

ALTER TABLE public.transactions
DROP CONSTRAINT IF EXISTS transactions_budget_behavior_check;

ALTER TABLE public.transactions
DROP COLUMN IF EXISTS transaction_kind,
DROP COLUMN IF EXISTS budget_behavior;
