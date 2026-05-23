-- Add category-level budget exclusion support.
ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS is_excluded_from_budget BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_categories_budget_exclusion
ON public.categories(user_id, is_excluded_from_budget);

-- Preserve intent for any existing hand-created excluded categories.
UPDATE public.categories
SET is_excluded_from_budget = true,
    icon = COALESCE(icon, '🚫'),
    color = COALESCE(color, '#9e9e9e')
WHERE lower(name) IN ('excluded', 'exclude', 'not counted', 'not included')
   OR name_zh IN ('不计入', '不纳入预算', '排除');

-- Seed the excluded category for existing users.
INSERT INTO public.categories (
  user_id,
  name,
  name_zh,
  icon,
  color,
  type,
  sort_order,
  is_excluded_from_budget
)
SELECT
  profiles.id,
  'Excluded',
  '不计入',
  '🚫',
  '#9e9e9e',
  'expense',
  999,
  true
FROM public.profiles profiles
WHERE NOT EXISTS (
  SELECT 1
  FROM public.categories c
  WHERE c.user_id = profiles.id
    AND (
      lower(c.name) = 'excluded'
      OR c.name_zh = '不计入'
      OR c.is_excluded_from_budget = true
    )
);
