import test from 'node:test'
import assert from 'node:assert/strict'

import { calculateMonthlySummary } from '@/modules/budget/budget.engine'
import type {
  BudgetEngineInput,
  BudgetCategoryInput,
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
        { id: 'tx1', amount: 50, date: '2026-05-03', categoryId: 'cat_groceries', type: 'expense' },
        { id: 'tx2', amount: 30, date: '2026-05-15', categoryId: 'cat_groceries', type: 'expense' },
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

test('full refund in same month reduces spend to zero', () => {
  const result = calculateMonthlySummary(
    makeInput({
      month: '2026-01',
      categories: [groceries],
      transactions: [
        { id: 'purchase', amount: 100, date: '2026-01-10', categoryId: 'cat_groceries', type: 'expense' },
        { id: 'refund', amount: -100, date: '2026-01-15', categoryId: 'cat_groceries', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-01', amount: 200 }],
    })
  )

  assert.equal(result.categories[0].actualSpend, 0)
  assert.equal(result.categories[0].remaining, 200)
})

test('partial refund reduces expense-category spend by the refund amount', () => {
  const result = calculateMonthlySummary(
    makeInput({
      month: '2026-01',
      categories: [groceries],
      transactions: [
        { id: 'purchase', amount: 100, date: '2026-01-10', categoryId: 'cat_groceries', type: 'expense' },
        { id: 'refund', amount: -30, date: '2026-01-20', categoryId: 'cat_groceries', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-01', amount: 200 }],
    })
  )

  assert.equal(result.categories[0].actualSpend, 70)
  assert.equal(result.categories[0].remaining, 130)
})

test('cross-month refund counts in the month supplied by its budget-effective date', () => {
  const january = calculateMonthlySummary(
    makeInput({
      month: '2026-01',
      categories: [groceries],
      transactions: [
        { id: 'purchase', amount: 100, date: '2026-01-20', categoryId: 'cat_groceries', type: 'expense' },
        { id: 'refund', amount: -100, date: '2026-01-20', categoryId: 'cat_groceries', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-01', amount: 200 }],
    })
  )

  const february = calculateMonthlySummary(
    makeInput({
      month: '2026-02',
      categories: [groceries],
      transactions: [
        { id: 'refund', amount: -100, date: '2026-01-20', categoryId: 'cat_groceries', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-02', amount: 200 }],
    })
  )

  assert.equal(january.categories[0].actualSpend, 0)
  assert.equal(february.categories[0].actualSpend, 0)
})

test('reimbursement offsets the original expense category', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [dining],
      transactions: [
        { id: 'dinner', amount: 80, date: '2026-05-03', categoryId: 'cat_dining', type: 'expense' },
        { id: 'venmo', amount: -40, date: '2026-05-04', categoryId: 'cat_dining', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_dining', month: '2026-05', amount: 120 }],
    })
  )

  assert.equal(result.categories[0].actualSpend, 40)
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
        { id: 'tx1', amount: 1000, date: '2026-05-01', categoryId: 'cat_excluded', type: 'expense' },
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

test('explicit count_as_spending can include a category legacy rules exclude', () => {
  const debtPayment: BudgetCategoryInput = {
    id: 'cat_debt',
    name: 'Debt Payment',
    type: 'transfer',
    isExcludedFromBudget: true,
  }

  const result = calculateMonthlySummary(
    makeInput({
      categories: [debtPayment],
      transactions: [
        {
          id: 'tx_debt',
          amount: 300,
          date: '2026-05-04',
          categoryId: 'cat_debt',
          type: 'transfer',
          budgetBehavior: 'count_as_spending',
        },
      ],
      budgetRules: [{ categoryId: 'cat_debt', month: '2026-05', amount: 300 }],
    })
  )

  assert.equal(result.categories.length, 1)
  assert.equal(result.categories[0].categoryId, 'cat_debt')
  assert.equal(result.categories[0].actualSpend, 300)
  assert.equal(result.totalBaseBudget, 300)
})

test('hidden transaction not counted', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: 50, date: '2026-05-05', categoryId: 'cat_groceries', type: 'expense', isHidden: true },
        { id: 'tx2', amount: 20, date: '2026-05-06', categoryId: 'cat_groceries', type: 'expense' },
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
        { id: 'tx1', amount: 500, date: '2026-05-01', categoryId: 'cat_groceries', type: 'transfer' },
        { id: 'tx2', amount: 3000, date: '2026-05-01', categoryId: 'cat_income', type: 'income' },
        { id: 'tx3', amount: 25, date: '2026-05-10', categoryId: 'cat_groceries', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 100 }],
    })
  )

  // Only the expense transaction should be counted; income category not in output
  assert.equal(result.categories.length, 1)
  assert.equal(result.categories[0].actualSpend, 25)
})

test('explicit budget behavior overrides expense-category fallback', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        {
          id: 'transfer',
          amount: 500,
          date: '2026-05-01',
          categoryId: 'cat_groceries',
          type: 'expense',
          budgetBehavior: 'exclude_as_transfer',
        },
        {
          id: 'income',
          amount: -3000,
          date: '2026-05-02',
          categoryId: 'cat_groceries',
          type: 'expense',
          budgetBehavior: 'count_as_income',
        },
        {
          id: 'manual',
          amount: 75,
          date: '2026-05-03',
          categoryId: 'cat_groceries',
          type: 'expense',
          budgetBehavior: 'exclude_manual',
        },
        {
          id: 'purchase',
          amount: 25,
          date: '2026-05-10',
          categoryId: 'cat_groceries',
          type: 'expense',
          budgetBehavior: 'count_as_spending',
        },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 100 }],
    })
  )

  assert.equal(result.categories.length, 1)
  assert.equal(result.categories[0].actualSpend, 25)
})

test('pending transaction excluded by default', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: 40, date: '2026-05-05', categoryId: 'cat_groceries', type: 'expense', status: 'pending' },
        { id: 'tx2', amount: 10, date: '2026-05-06', categoryId: 'cat_groceries', type: 'expense', status: 'posted' },
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
        { id: 'tx1', amount: 40, date: '2026-05-05', categoryId: 'cat_groceries', type: 'expense', status: 'pending' },
        { id: 'tx2', amount: 10, date: '2026-05-06', categoryId: 'cat_groceries', type: 'expense', status: 'posted' },
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
        { id: 'tx1', amount: 20, date: '2026-05-10', categoryId: 'cat_groceries', type: 'expense' },
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
        { id: 'tx1', amount: 150, date: '2026-05-01', categoryId: 'cat_groceries', type: 'expense' },
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
        { id: 'tx1', amount: 10, date: '2026-05-05', categoryId: 'cat_groceries', type: 'expense' },
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
        { id: 'tx1', amount: 80, date: '2026-05-03', categoryId: 'cat_groceries', type: 'expense' },
        { id: 'tx2', amount: 45, date: '2026-05-12', categoryId: 'cat_dining', type: 'expense' },
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


test('month boundary includes first day and excludes next month start', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: 25, date: '2026-05-01', categoryId: 'cat_groceries', type: 'expense' },
        { id: 'tx2', amount: 40, date: '2026-06-01', categoryId: 'cat_groceries', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 100 }],
    })
  )

  assert.equal(result.categories[0].actualSpend, 25)
})

test('transaction without categoryId is not counted', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: 25, date: '2026-05-10', categoryId: null, type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 100 }],
    })
  )

  assert.equal(result.categories[0].actualSpend, 0)
})

test('transaction with unknown categoryId is not counted', () => {
  const result = calculateMonthlySummary(
    makeInput({
      categories: [groceries],
      transactions: [
        { id: 'tx1', amount: 25, date: '2026-05-10', categoryId: 'cat_unknown', type: 'expense' },
      ],
      budgetRules: [{ categoryId: 'cat_groceries', month: '2026-05', amount: 100 }],
    })
  )

  assert.equal(result.categories[0].actualSpend, 0)
})
