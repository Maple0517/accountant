# Product Rules

## Purpose

Define how Accountant should interpret transactions at the product level.

This should guide every implementation decision in the transaction semantics project.

## Core Rule

Every imported row is a transaction.

But not every transaction should affect:

- Spending
- Income
- Budget
- Cash flow
- Net worth summaries

## Product Taxonomy

### Normal Transaction

A normal transaction is a real-world financial event that is not specifically a refund, reimbursement, or internal transfer.

Examples:

- Grocery purchase
- Restaurant payment
- Subscription payment
- Salary deposit
- Bank fee
- Credit card interest charge
- Manual receipt transaction

Important nuance:

`normal` does not always mean expense. A salary deposit can be normal but income-like depending on category and budget behavior.

### Refund

A refund is a merchant returning money for a previous purchase.

Examples:

- Amazon refund
- Apple refund
- Restaurant charge reversal
- Returned item credit

Product behavior:

- Link to the original purchase when possible.
- Inherit original category when possible.
- Use original purchase date as `budget_effective_date` when matched.
- Count as negative spending, not income.

### Reimbursement

A reimbursement is money returned by a third party, usually after the user paid for something.

Examples:

- Employer reimburses Uber
- Friend pays back a dinner split
- Insurance reimbursement

Product behavior should be configurable:

Option A, recommended default:
- Link to original expense.
- Offset original category spending.
- Use original date as budget effective date.

Option B:
- Treat as income.

Option C:
- Exclude from reports.

### Transfer

A transfer is movement between the user's own accounts.

Examples:

- Checking to savings
- Savings to checking
- Checking to credit card payment
- Credit card payment received
- Checking to investment account
- Checking to loan payment principal

Product behavior:

- Keep visible in transaction list.
- Exclude from spending.
- Exclude from income.
- Exclude from budget.
- Group related legs when possible.

## Budget Behavior Rules

Introduce a transaction-level concept called `budget_behavior`.

Recommended values:

```text
count_as_spending
count_as_income
exclude_as_transfer
exclude_manual
```

Default rules:

| Scenario | transaction_kind | budget_behavior |
|---|---|---|
| Credit card purchase | normal | count_as_spending |
| Debit card purchase | normal | count_as_spending |
| Salary deposit | normal | count_as_income |
| Interest income | normal | count_as_income |
| Merchant refund | refund | count_as_spending |
| Employer reimbursement | reimbursement | count_as_spending by default |
| Checking to savings | transfer | exclude_as_transfer |
| Credit card payment | transfer | exclude_as_transfer |
| Historical debt payment | transfer or normal | count_as_spending |
| Manually hidden transaction | any | exclude_manual |

## Product Wording

Avoid exposing implementation terms to users.

Preferred labels:

```text
Count as spending
Count as income
Treat as transfer
Exclude from reports
```

Advanced labels:

```text
Normal
Refund
Reimbursement
Transfer
Linked transaction
Budget date
Transfer match
```

## AI Role

AI can help with fuzzy classification, but deterministic product rules should win.

Priority order:

1. User manual override.
2. User-created rules.
3. Deterministic system rules.
4. Plaid category mapping.
5. Gemini classification.
6. Safe default.

## Key Product Principle

Credit card payment is still a transaction, but it is not spending.

Refund is still a transaction, but it offsets spending.

Reimbursement is still a transaction, but it is not always income.

Transfer is still a transaction, but it is money moving inside the user's own financial system.
