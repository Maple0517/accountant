import test from 'node:test'
import assert from 'node:assert/strict'

import { calculateMonthlySummary } from '@/modules/budget/budget.engine'
import type {
  BudgetEngineInput,
  BudgetCategoryInput,
  BudgetTransactionInput,
  BudgetRuleInput,
  BudgetSettingsInput,
} from '@/modules/budget/budget.types'

// ---------------------------------------------------------------------------
// Shared helpers & fixtures
// ---------------------------------------------------------------------------

function makeSettings(overrides: Partial<BudgetSettingsInput> = {}): BudgetSettingsInput {
  return {
    budgetingEnabled: true,
    includePendingTransactions: false,
    ...overrides,
  }
}

function makeInput(overrides: Partial<BudgetEngineInput> = {}): BudgetEngineInput {
  return {
    userId: 'user_1',
    month: '2026-05',
    categories: [],
    transactions: [],
    budgetRules: [],
    settings: makeSettings(),
    ...overrides,
  }
}

const groceries: BudgetCategoryInput = {
  id: 'cat_groceries',
  name: 'Groceries',
  type: 'expense',
  isExcludedFromBudget: false,
}

const dining: BudgetCategoryInput = {
  id: 'cat_dining',
  name: 'Dining',
  type: 'expense',
  isExcludedFromBudget: false,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('normal category budget calculation', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: -50, date: '2026-05-03', categoryId: 'cat_groceries', type: 'expense' },
        { id: 'tx2', amount: -30, date: '2026-05-15', categoryId: 'cat_groceries', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 200 }],
    })
  )

  assert.equal(result.categories.length, 1)
  const cat = result.categories[0]
  assert.equal(cat.baseBudget, 200)
  assert.equal(cat.actualSpend, 80)
  assert.equal(cat.remaining, 120)
  assert.equal(cat.percentUsed, 0.4)
  assert.equal(cat.status, 'under')
})

test('excluded category not counted', () => {
  const excluded: BudgetCategoryInput = {
    id: 'cat_excluded',
    name: 'Mortgage',
    type: 'expense',
    isExcludedFromBudget: true,
  }

  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries, excluded],
      transactions: [
        { id: 'tx1', amount: -1000, date: '2026-05-01', categoryId: 'cat_excluded', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_excluded', month: '2026-05', amount: 1000 }],
    })
  )

  // Excluded category should not appear in output at all
  assert.equal(result.categories.length, 1)
  assert.equal(result.categories[0].categoryId, 'cat_groceries')
  // Totals should not include excluded spend
  assert.equal(result.totalActualSpend, 0)
  assert.equal(result.totalBaseBudget, 0)
})

test('hidden transaction not counted', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: -50, date: '2026-05-05', categoryId: 'cat_groceries', type: 'expense', isHidden: true },
        { id: 'tx2', amount: -20, date: '2026-05-06', categoryId: 'cat_groceries', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 100 }],
    })
  )

  assert.equal(result.categories[0].actualSpend, 20)
})

test('transfer and income transactions not counted', () => {
  const income: BudgetCategoryInput = {
    id: 'cat_income',
    name: 'Salary',
    type: 'income',
    isExcludedFromBudget: false,
  }

  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries, income],
      transactions: [
        { id: 'tx1', amount: -500, date: '2026-05-01', categoryId: 'cat_groceries', type: 'transfer' },
        { id: 'tx2', amount: -3000, date: '2026-05-01', categoryId: 'cat_income', type: 'income' },
        { id: 'tx3', amount: -25, date: '2026-05-10', categoryId: 'cat_groceries', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 100 }],
    })
  )

  // Only the expense transaction should be counted; income category not in output
  assert.equal(result.categories.length, 1)
  assert.equal(result.categories[0].actualSpend, 25)
})

test('pending transaction excluded by default', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: -40, date: '2026-05-05', categoryId: 'cat_groceries', type: 'expense', status: 'pending' },
        { id: 'tx2', amount: -10, date: '2026-05-06', categoryId: 'cat_groceries', type: 'expense', status: 'posted' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 100 }],
    })
  )

  // Only posted transaction counted
  assert.equal(result.categories[0].actualSpend, 10)
})

test('pending transaction included when setting enabled', () => {
  const result = calculateMonthlySummary(
    makeInput({
      settings: makeSettings({ includePendingTransactions: true }),
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: -40, date: '2026-05-05', categoryId: 'cat_groceries', type: 'expense', status: 'pending' },
        { id: 'tx2', amount: -10, date: '2026-05-06', categoryId: 'cat_groceries', type: 'expense', status: 'posted' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 100 }],
    })
  )

  // Both transactions counted
  assert.equal(result.categories[0].actualSpend, 50)
})

test('no budget category — status is no_budget and percentUsed is null', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: -20, date: '2026-05-10', categoryId: 'cat_groceries', type: 'expense' },
      ],
      // No budget rules
      budgetRules: [],
    })
  )

  const cat = result.categories[0]
  assert.equal(cat.baseBudget, 0)
  assert.equal(cat.percentUsed, null)
  assert.equal(cat.status, 'no_budget')
})

test('over budget — status is over', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: -150, date: '2026-05-01', categoryId: 'cat_groceries', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 100 }],
    })
  )

  const cat = result.categories[0]
  assert.equal(cat.status, 'over')
  assert.equal(cat.remaining, -50)
  assert.equal(cat.percentUsed, 1.5)
})

test('zero budget — percentUsed is null not Infinity', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: -10, date: '2026-05-05', categoryId: 'cat_groceries', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 0 }],
    })
  )

  const cat = result.categories[0]
  assert.equal(cat.baseBudget, 0)
  assert.equal(cat.percentUsed, null)
  assert.notEqual(cat.percentUsed, Infinity)
})

test('total aggregation correct', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries, dining],
      transactions: [
        { id: 'tx1', amount: -80, date: '2026-05-03', categoryId: 'cat_groceries', type: 'expense' },
        { id: 'tx2', amount: -45, date: '2026-05-12', categoryId: 'cat_dining', type: 'expense' },
      ],
      budgetRules: [
        { categoryId: 'cat_groceries', month: '2026-05', amount: 200 },
        { categoryId: 'cat_dining', month: '2026-05', amount: 100 },
      ],
    })
  )

  assert.equal(result.totalBaseBudget, 300)
  assert.equal(result.totalActualSpend, 125)
  assert.equal(result.totalRemaining, 175)
  assert.equal(result.totalPercentUsed, 125 / 300)
})
