# Testing and Acceptance Criteria

## Purpose

Define product-level tests for transaction semantics.

These tests should guide subagents and prevent regressions.

## Test 1: Credit Card Purchase + Payment

Input:

```text
Credit Card purchase: +100 Groceries
Checking payment: +100 outflow under Accountant convention if applicable
Credit card payment received: -100 credit under Accountant convention if applicable
```

Expected:

```text
Purchase:
  transaction_kind = normal
  budget_behavior = count_as_spending

Payment legs:
  transaction_kind = transfer
  budget_behavior = exclude_as_transfer

Total spending:
  100

Total income:
  0
```

## Test 2: Checking to Savings Transfer

Input:

```text
Checking transfer out
Savings transfer in
```

Expected:

```text
Both transactions:
  transaction_kind = transfer
  budget_behavior = exclude_as_transfer
  same transfer_group_id if matched

Spending:
  0

Income:
  0
```

## Test 3: Salary Deposit

Input:

```text
Payroll deposit
```

Expected:

```text
budget_behavior = count_as_income
income increases
spending unchanged
budget unchanged
```

## Test 4: Amazon Refund

Input:

```text
Amazon purchase +120
Amazon refund -120
```

Expected:

```text
Refund:
  transaction_kind = refund
  linked_transaction_id = purchase id
  category = purchase category
  budget_effective_date = purchase date
  budget_behavior = count_as_spending

Net Shopping spending:
  0
```

## Test 5: Unmatched Refund

Input:

```text
Refund-like transaction with no matching original purchase
```

Expected:

```text
transaction_kind = refund
budget_behavior = count_as_spending
budget_effective_date = transaction date
no income impact
```

## Test 6: Employer Reimbursement

Input:

```text
Travel expense +300
Employer reimbursement -300
```

Expected default:

```text
Reimbursement:
  transaction_kind = reimbursement
  budget_behavior = count_as_spending
  linked to original if matched
  offsets Travel spending
```

Alternative user override:

```text
Count as income:
  budget_behavior = count_as_income
```

## Test 7: Historical Credit Card Debt Payment

Input:

```text
Checking payment to credit card
Credit card payment received
User marks checking side as existing debt repayment
```

Expected:

```text
Checking side:
  budget_behavior = count_as_spending
  category = Debt Payment

Credit card side:
  budget_behavior = exclude_as_transfer

Spending:
  includes checking-side debt payment once
```

## Test 8: Credit Card Interest

Input:

```text
Credit card interest charge
```

Expected:

```text
transaction_kind = normal
budget_behavior = count_as_spending
category = Interest or Fees
not transfer
```

## Test 9: Bank Fee

Input:

```text
Overdraft fee
ATM fee
wire fee
```

Expected:

```text
transaction_kind = normal
budget_behavior = count_as_spending
category = Fees
not transfer
```

## Test 10: Manual Exclusion

Input:

```text
User excludes transaction from reports
```

Expected:

```text
budget_behavior = exclude_manual
not included in spending
not included in income
manual choice is not overwritten by sync
```

## Test 11: User Rejects Suggested Transfer

Input:

```text
System suggests a transfer match
User rejects it
```

Expected:

```text
transfer_match_status = ignored
same pair is not repeatedly suggested
budget behavior follows user's selected treatment
```

## Test 12: Notion Sync

Input:

```text
Transaction semantics updated in app
```

Expected:

```text
Notion row reflects:
  transaction kind
  budget behavior
  budget effective date
  linked transaction if present
  transfer status if present
```

## Global Acceptance Criteria

The implementation is acceptable when:

1. Credit card payments no longer double-count spending.
2. Transfers do not appear as income or expenses.
3. Refunds reduce spending instead of increasing income.
4. Reimbursements can offset original expenses.
5. Historical debt payments can intentionally count in budget.
6. Budget calculations are transaction-driven.
7. User overrides are preserved.
8. Notion sync reflects the same transaction semantics as the app.
9. Existing refund behavior does not regress.
10. The system remains explainable to the user.
