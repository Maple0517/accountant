import test from 'node:test'
import assert from 'node:assert/strict'

import { getCategoryPatchForSplitTreatment } from '@/lib/transactions/split-ui'

test('split exclude treatment selects the Excluded category when available', () => {
  const patch = getCategoryPatchForSplitTreatment(
    { treatment: 'excluded' },
    [
      {
        id: 'cat_housing',
        name: 'Housing',
        is_excluded_from_budget: false,
      },
      {
        id: 'cat_excluded',
        name: 'Excluded',
        is_excluded_from_budget: true,
      },
    ]
  )

  assert.deepEqual(patch, { category_id: 'cat_excluded' })
})

test('split non-exclude treatments do not rewrite the selected category', () => {
  const patch = getCategoryPatchForSplitTreatment(
    { treatment: 'spending' },
    [
      {
        id: 'cat_excluded',
        name: 'Excluded',
        is_excluded_from_budget: true,
      },
    ]
  )

  assert.deepEqual(patch, {})
})
