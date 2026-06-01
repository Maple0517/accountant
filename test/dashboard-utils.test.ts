import test from 'node:test'
import assert from 'node:assert/strict'

import { getMonthlySemanticAmounts } from '@/features/dashboard/dashboard-utils'

test('dashboard monthly totals ignore excluded budget categories', () => {
  assert.deepEqual(
    getMonthlySemanticAmounts({
      amount: 3126,
      treatment: 'spending',
      categories: { is_excluded_from_budget: true },
    }),
    { spending: 0, income: 0 }
  )
})
