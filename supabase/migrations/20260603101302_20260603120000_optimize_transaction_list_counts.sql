-- Reduce transaction-list count round trips and support tag containment filters.

CREATE INDEX IF NOT EXISTS transactions_tags_gin_idx
  ON public.transactions
  USING gin(tags);

CREATE OR REPLACE FUNCTION public.get_transaction_list_counts(
  p_user_id uuid,
  p_search text DEFAULT '',
  p_source_or_account text DEFAULT 'all',
  p_category text DEFAULT 'all',
  p_currency text DEFAULT 'all',
  p_date_from text DEFAULT '',
  p_date_to text DEFAULT '',
  p_show_hidden boolean DEFAULT false,
  p_show_deleted boolean DEFAULT false,
  p_show_split_parents boolean DEFAULT false,
  p_split_group_id text DEFAULT '',
  p_tx text DEFAULT ''
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      NULLIF(regexp_replace(COALESCE(p_search, ''), '[%,]', '', 'g'), '') AS search_term,
      NULLIF(p_date_from, '')::date AS date_from,
      NULLIF(p_date_to, '')::date AS date_to,
      NULLIF(p_split_group_id, '') AS split_group_id,
      NULLIF(p_tx, '') AS tx_id
  ),
  filtered AS (
    SELECT t.*
    FROM public.transactions AS t
    CROSS JOIN params
    WHERE t.user_id = p_user_id
      AND (p_show_deleted OR t.deleted_at IS NULL)
      AND (p_show_hidden OR t.is_hidden_from_reports = false)
      AND (p_show_split_parents OR t.split_role <> 'parent')
      AND (params.split_group_id IS NULL OR t.split_group_id::text = params.split_group_id)
      AND (
        params.tx_id IS NULL
        OR t.id::text = params.tx_id
      )
      AND (
        params.tx_id IS NOT NULL
        OR (
          (
            params.search_term IS NULL
            OR t.merchant_name ILIKE '%' || params.search_term || '%'
            OR t.description ILIKE '%' || params.search_term || '%'
          )
          AND CASE
            WHEN p_source_or_account = 'manual' THEN t.source = 'manual'
            WHEN p_source_or_account = 'receipt' THEN t.source = 'receipt'
            WHEN starts_with(p_source_or_account, 'account:') THEN t.account_id::text = substring(p_source_or_account from 9)
            ELSE true
          END
          AND CASE
            WHEN p_category = 'uncategorized' THEN t.category_id IS NULL
            WHEN p_category IS NULL OR p_category = '' OR p_category = 'all' THEN true
            ELSE t.category_id::text = p_category
          END
          AND (p_currency = 'all' OR p_currency IS NULL OR p_currency = '' OR t.iso_currency_code = p_currency)
          AND (params.date_from IS NULL OR t.effective_date >= params.date_from)
          AND (params.date_to IS NULL OR t.effective_date <= params.date_to)
        )
      )
  )
  SELECT jsonb_build_object(
    'view_counts',
    jsonb_build_object(
      'all', COUNT(*),
      'needs_review', COUNT(*) FILTER (
        WHERE pending = false
          AND (
            category_id IS NULL
            OR tags @> ARRAY['classification:ai-pending']::text[]
            OR tags @> ARRAY['classification:plaid-fallback']::text[]
            OR (
              treatment = 'refund'
              AND linked_transaction_id IS NULL
              AND (
                refund_match_reason IS NULL
                OR refund_match_reason <> 'manual-reviewed'
              )
            )
            OR (
              treatment = 'transfer'
              AND (
                transfer_match_status IS NULL
                OR transfer_match_status IN ('unmatched', 'suggested')
              )
            )
          )
      ),
      'uncategorized', COUNT(*) FILTER (WHERE category_id IS NULL),
      'ai_pending', COUNT(*) FILTER (
        WHERE tags @> ARRAY['classification:ai-pending']::text[]
           OR tags @> ARRAY['classification:plaid-fallback']::text[]
      ),
      'refunds', COUNT(*) FILTER (WHERE treatment = 'refund'),
      'transfers', COUNT(*) FILTER (
        WHERE treatment = 'transfer'
           OR transfer_match_status IS NOT NULL
      ),
      'pending', COUNT(*) FILTER (WHERE pending = true),
      'large', COUNT(*) FILTER (WHERE amount >= 100 OR amount <= -100)
    ),
    'all_ai_pending_count',
    (
      SELECT COUNT(*)
      FROM public.transactions AS ai_tx
      WHERE ai_tx.user_id = p_user_id
        AND ai_tx.deleted_at IS NULL
        AND ai_tx.is_hidden_from_reports = false
        AND ai_tx.split_role <> 'parent'
        AND (
          ai_tx.tags @> ARRAY['classification:ai-pending']::text[]
          OR ai_tx.tags @> ARRAY['classification:plaid-fallback']::text[]
        )
    )
  )
  FROM filtered;
$$;

GRANT EXECUTE ON FUNCTION public.get_transaction_list_counts(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean,
  boolean,
  text,
  text
) TO authenticated;
