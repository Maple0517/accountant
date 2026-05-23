# Data Model Evolution

## Purpose

Evolve the current schema without replacing the existing transaction model.

Accountant already has a useful semantic foundation:

```text
transaction_kind
linked_transaction_id
budget_effective_date
refund_match_confidence
refund_match_reason
```

Keep those fields and add the missing transaction-level budget and transfer relationship concepts.

## Keep Existing Fields

Continue using:

```text
transaction_kind:
  normal
  refund
  reimbursement
  transfer
```

Continue using `linked_transaction_id` for refund/reimbursement relationships.

Continue using `budget_effective_date` for reporting/budget month assignment, especially refunds and reimbursements.

## Add `budget_behavior`

Add a transaction-level field:

```text
budget_behavior:
  count_as_spending
  count_as_income
  exclude_as_transfer
  exclude_manual
```

Why this is needed:

Category-level exclusion is too coarse. The same category can have transactions with different budget treatment.

Examples:

- Transfer category transaction normally excluded.
- Historical debt payment may use Debt Payment category and count as spending.
- Expense category transaction can be manually excluded.
- Refund can use expense category but count as negative spending.

## Add Transfer Relationship Fields

Do not overload `linked_transaction_id` for transfer pairs.

Add:

```text
transfer_group_id
transfer_match_status
transfer_match_confidence
transfer_match_reason
```

Recommended statuses:

```text
unmatched
auto_matched
suggested
manually_matched
ignored
```

Usage:

- `transfer_group_id` groups two or more transaction legs.
- `transfer_match_status` explains matching state.
- `transfer_match_confidence` supports UI confidence display.
- `transfer_match_reason` gives short system explanation.

## Relationship Semantics

Use these rules:

```text
linked_transaction_id:
  refund or reimbursement points to original transaction.

transfer_group_id:
  checking leg and credit card leg belong to same money movement.

transaction_kind:
  describes what transaction is.

budget_behavior:
  describes how reporting/budgeting treats it.
```

## Manual Override Strategy

Add or support a clear notion of user override.

This can be explicit or implicit, but the product needs a way to know:

```text
This transaction's semantic treatment was manually chosen by the user.
Do not overwrite it during future Plaid sync, Gemini classification, or system matching.
```

Recommended conceptual field:

```text
semantic_override_source:
  system
  user
  rule
  ai
```

This field is optional for phase 1 but strongly recommended before automation becomes more aggressive.

## Category Relationship

Keep categories as grouping and display concepts.

Do not make categories the only source of truth for budget impact.

Category should answer:

```text
Which bucket does this transaction belong to?
```

Budget behavior should answer:

```text
Should this transaction affect budget at all?
```

## Backward Compatibility

Existing transactions should be backfilled safely.

Default mapping:

```text
transaction_kind = transfer:
  budget_behavior = exclude_as_transfer

category.type = income:
  budget_behavior = count_as_income

category.type = expense:
  budget_behavior = count_as_spending

category.type = transfer:
  budget_behavior = exclude_as_transfer

category.is_excluded_from_budget = true:
  budget_behavior = exclude_manual or exclude_as_transfer depending on category type
```

Use conservative defaults. Avoid changing visible totals aggressively without clear migration notes.
