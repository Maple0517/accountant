# Budget Behavior Layer

## Purpose

Move Accountant from category-driven budgeting to transaction-driven budgeting.

Current behavior is mostly category-based:

```text
category.type
category.is_excluded_from_budget
transaction amount
```

This is not enough for refunds, reimbursements, transfers, and historical debt repayment.

## Target Behavior

Budget should use transaction-level `budget_behavior` first.

```text
count_as_spending:
  Included in spending and category budgets.

count_as_income:
  Included in income summaries.

exclude_as_transfer:
  Excluded from spending, income, and budget.

exclude_manual:
  Excluded from default reports.
```

## Category Role After This Change

Category remains important, but only after budget behavior says the transaction should be included.

Examples:

```text
count_as_spending + Groceries:
  contributes to Groceries budget.

count_as_spending + Debt Payment:
  contributes to Debt Payment budget.

exclude_as_transfer + Transfer:
  shown in transactions, excluded from budget.

count_as_income + Salary:
  shown in income.
```

## Budget Effective Date

Use `budget_effective_date` for budget month assignment when present.

This is especially important for:

- Refunds
- Reimbursements
- Manual corrections
- Future support for transaction splits or adjustments

Recommended rule:

```text
budget date = budget_effective_date ?? transaction.date
```

## Amount Semantics

Accountant stores Plaid amount convention:

```text
positive = expense/outflow
negative = income/credit/inflow
```

Budget engine should preserve this convention and calculate net spending accordingly.

Examples:

```text
Purchase +100:
  spending increases by 100.

Refund -100:
  spending decreases by 100.

Salary -5000:
  income increases by 5000 in income view.
```

Income reporting may need sign normalization for display, but the underlying convention should remain consistent.

## Budget Inclusion Rules

For spending budget:

```text
Include transactions where:
  budget_behavior = count_as_spending
  category is not null
  transaction is not deleted/hidden
  pending setting allows it
```

For income:

```text
Include transactions where:
  budget_behavior = count_as_income
```

For transfer totals:

```text
Include transactions where:
  budget_behavior = exclude_as_transfer
```

These can be shown separately in cash flow, but not mixed into spending.

## Migration Strategy

Do not immediately remove category-level exclusion.

For one transitional phase:

```text
budget_behavior absent:
  fallback to existing category logic
```

After migration and backfill:

```text
budget_behavior present:
  use budget_behavior as source of truth
```

## User-Facing Outcome

After this change:

- Credit card payments stop inflating spending.
- Checking-to-savings transfers stop appearing as expenses.
- Refunds reduce the correct month/category.
- Reimbursements can offset expenses.
- Historical debt payments can intentionally count as spending.
- Manual exclusions become transaction-specific instead of category-specific.
