# Notion Sync Behavior

## Purpose

Keep Notion views consistent with Accountant's internal transaction semantics.

Accountant already syncs transactions to Notion. After this project, Notion should expose enough semantic fields to explain why app totals behave the way they do.

## Recommended Notion Properties

Add or sync these fields:

```text
Transaction Kind
Budget Behavior
Budget Effective Date
Linked Transaction
Transfer Group
Transfer Match Status
Transfer Match Confidence
Transfer Match Reason
```

## User-Facing Labels

Use readable labels:

```text
Kind
Budget Treatment
Budget Date
Linked Transaction
Transfer Status
Match Confidence
Reason
```

## Examples

### Refund

```text
Kind: Refund
Budget Treatment: Counts as Spending
Budget Date: 2026-05-03
Linked Transaction: Amazon Purchase
Reason: matched original purchase
```

### Credit Card Payment

```text
Kind: Transfer
Budget Treatment: Excluded as Transfer
Transfer Status: Matched
Reason: checking to credit card payment
```

### Historical Debt Payment

```text
Kind: Transfer
Budget Treatment: Counts as Spending
Category: Debt Payment
Reason: user marked as existing debt repayment
```

### Manual Exclusion

```text
Kind: Normal
Budget Treatment: Excluded Manually
Reason: user excluded
```

## Sync Rules

When transaction semantics change in Accountant:

- Update Notion row.
- Preserve Notion page identity.
- Avoid creating duplicate pages.
- Ensure Notion shows same budget behavior as app.

## Important Product Rule

Notion should not become the source of truth for transaction semantics unless intentionally designed.

Recommended source of truth:

```text
Supabase transactions table
```

Notion is an external view/sync target.

## Acceptance Criteria

1. Notion shows whether a transaction counts as spending/income/transfer/excluded.
2. Notion shows refund/reimbursement linked transaction where available.
3. Notion shows transfer match status where available.
4. App and Notion no longer disagree about why a transaction is excluded.
