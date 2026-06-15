import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

test('budget rows render unbudgeted categories without spent-of-zero copy', () => {
  const source = readFileSync(join(root, 'src/app/(dashboard)/budgets/page.tsx'), 'utf8')

  assert.match(source, /budgets\.unbudgetedAmount/)
  assert.match(source, /budgets\.noBudgetSet/)
  assert.doesNotMatch(source, /budgets\.spentOf/)
})
