# Refunds and Reimbursements

## Purpose

Strengthen the current refund system and clearly separate refunds from reimbursements.

Accountant already has refund/reimbursement metadata. This plan keeps and extends it.

## Refund

A refund is money returned by the merchant for a previous purchase.

Examples:

```text
Amazon purchase
Amazon refund
Apple refund
Restaurant reversal
```

Recommended behavior:

```text
transaction_kind = refund
linked_transaction_id = original purchase
category = original purchase category
budget_effective_date = original purchase date
budget_behavior = count_as_spending
```

Why:

Refund should reduce spending, not appear as income.

## Refund Matching

Keep using existing match logic, but ensure product semantics are clear.

Matching signals:

```text
same or similar merchant
opposite sign
same amount or close amount
within reasonable date window
same account when possible
same category when possible
```

Recommended UI status:

```text
Refund · Linked
Refund · Possible Match
Refund · Unmatched
```

## Unmatched Refund

If no original purchase is found:

```text
transaction_kind = refund
budget_behavior = count_as_spending
budget_effective_date = transaction date
```

It still reduces spending in its own month/category.

## Reimbursement

A reimbursement is money paid back by a third party.

Examples:

```text
Employer reimburses travel
Friend pays back dinner
Insurance reimburses medical bill
```

It is not the same as a merchant refund.

## Recommended Default

Default reimbursement behavior:

```text
transaction_kind = reimbursement
linked_transaction_id = original expense when possible
budget_behavior = count_as_spending
budget_effective_date = original expense date
category = original expense category
```

This offsets the original expense and better represents personal out-of-pocket spending.

## Alternative User Choices

Allow users to change reimbursement handling:

```text
Offset original spending
Count as income
Exclude from reports
```

Mapping:

```text
Offset original spending:
  budget_behavior = count_as_spending
  linked_transaction_id = original expense

Count as income:
  budget_behavior = count_as_income

Exclude from reports:
  budget_behavior = exclude_manual
```

## Avoid Common Mistakes

Do not automatically treat all positive account credits as income.

Do not treat merchant refunds as salary/income.

Do not force reimbursements to always offset if the user wants cash-flow income view.

## Budget Effective Date

If reimbursement is linked to original expense:

```text
budget_effective_date = original expense date
```

If not linked:

```text
budget_effective_date = transaction date
```

## Acceptance Criteria

1. Merchant refunds reduce spending.
2. Merchant refunds do not increase income.
3. Reimbursements are distinguishable from refunds.
4. Reimbursements can offset original expenses.
5. User can override reimbursement behavior.
