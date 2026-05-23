# Accountant Transaction Semantics Implementation Plan

## Purpose

This plan upgrades Accountant's transaction handling from simple category-based budgeting into a transaction semantics system.

The goal is not to decide whether a bank row is a transaction. Every imported bank row remains a transaction.

The goal is to decide:

1. What kind of transaction it is.
2. Whether it affects spending.
3. Whether it affects income.
4. Whether it affects budget.
5. Whether it is related to another transaction.
6. Whether it should be treated as an internal movement of money.

## Current Product Context

Accountant already has:

- Plaid transaction sync.
- Supabase `transactions`, `accounts`, `categories`, and `budgets`.
- Gemini-based classification.
- Refund/reimbursement metadata:
  - `transaction_kind`
  - `linked_transaction_id`
  - `budget_effective_date`
  - `refund_match_confidence`
  - `refund_match_reason`
- Category-level budget exclusion through `categories.is_excluded_from_budget`.
- Budget adapter that currently depends heavily on category type and category exclusion.
- Notion sync.
- iOS Shortcut receipt capture.

This plan should evolve the existing architecture, not replace it.

## Recommended Workstreams

Assign these documents to separate Codex subagents:

1. [Product Rules](./01-product-rules.md)
2. [Data Model Evolution](./02-data-model-evolution.md)
3. [Budget Behavior Layer](./03-budget-behavior-layer.md)
4. [Transfer Matching](./04-transfer-matching.md)
5. [Credit Card Payments](./05-credit-card-payments.md)
6. [Refunds and Reimbursements](./06-refunds-and-reimbursements.md)
7. [Transaction UI Behavior](./07-transaction-ui-behavior.md)
8. [Notion Sync Behavior](./08-notion-sync-behavior.md)
9. [Migration and Backfill Strategy](./09-migration-and-backfill-strategy.md)
10. [Testing and Acceptance Criteria](./10-testing-and-acceptance.md)

## Core Design Principle

Keep raw transactions. Do not hide, delete, or collapse them.

Add semantic treatment on top.

```text
Raw bank transaction
        ↓
Normalized transaction
        ↓
Transaction kind
        ↓
Budget behavior
        ↓
Reports / Budget / Income / Cash Flow / Net Worth
```

## Key Concepts

### `transaction_kind`

Describes what the transaction is.

Existing values should remain:

```text
normal
refund
reimbursement
transfer
```

### `budget_behavior`

Describes how reports and budgets should treat the transaction.

Recommended values:

```text
count_as_spending
count_as_income
exclude_as_transfer
exclude_manual
```

### Relationship fields

Use different relationship concepts for different business meanings.

```text
linked_transaction_id
  For refund/reimbursement relationships.

transfer_group_id
  For internal transfers with two or more legs.

transfer_match_status
  For transfer matching state.

transfer_match_confidence
  For auto/suggested transfer matching quality.

transfer_match_reason
  For short explainable system/user reason.
```

## High-Level Milestones

### Milestone 1: Define transaction-level budget behavior

Add a transaction-level budget treatment layer so budget logic does not rely only on category type.

### Milestone 2: Make budget calculations transaction-driven

Budget should primarily use `budget_behavior`, then use category only for grouping.

### Milestone 3: Add internal transfer detection

Automatically detect checking/savings/credit/investment account movements.

### Milestone 4: Handle credit card payments correctly

Credit card purchases count as spending. Credit card payments do not count as new spending.

### Milestone 5: Support historical credit card debt repayment

Allow the user to intentionally count a credit card payment as debt repayment spending.

### Milestone 6: Improve refund and reimbursement semantics

Refunds should offset original spending. Reimbursements need a clear product choice.

### Milestone 7: Add user override and explanation UI

Users must be able to understand and override how any transaction is treated.

### Milestone 8: Keep Notion sync consistent

Notion should reflect transaction semantics so external views do not diverge from the app.

## Non-Goals

Do not do these in this phase:

- Do not delete transfer transactions.
- Do not collapse two transfer legs into one hidden row.
- Do not rely on AI as the primary detector for credit card payments.
- Do not replace the current refund system wholesale.
- Do not make category exclusion the final source of truth for budget impact.
- Do not overload `linked_transaction_id` for all relationship types.
- Do not introduce complex accounting ledger semantics unless needed later.
