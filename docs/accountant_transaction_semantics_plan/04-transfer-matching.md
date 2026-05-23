# Transfer Matching

## Purpose

Detect internal transfers and group their two sides so they do not distort spending or income.

This is the foundation for correct credit card payment handling.

## What Counts as Transfer

Internal movement between the user's own accounts:

```text
checking -> savings
savings -> checking
checking -> credit card
savings -> credit card
checking -> investment
checking -> loan principal
credit card payment received
```

## What Does Not Count as Transfer

These are real expenses:

```text
credit card interest
late fee
bank fee
ATM fee
loan interest
service charge
wire fee if charged by bank
```

Do not classify these as transfer just because they mention a bank or account.

## Detection Pipeline

Transfer detection should run before Gemini classification.

Recommended order:

```text
1. User override
2. Existing user rule
3. Deterministic transfer detection
4. Refund/reimbursement detection
5. Plaid category fallback
6. Gemini category classification
7. Default normal
```

The exact order can be adjusted, but transfer detection should not rely primarily on AI.

## Candidate Detection

Use transaction text and account types.

Text keywords:

```text
payment
credit card payment
payment received
online payment
autopay
auto payment
thank you
transfer
xfer
ach transfer
withdrawal to
deposit from
```

Account type combinations:

```text
checking + savings
checking + credit
savings + credit
checking + investment
checking + other loan-like account
```

## Matching Conditions

Two transactions are potential transfer legs if:

```text
same user
different accounts
one amount is positive and the other is negative
absolute amounts are equal or close
dates are within 0-5 days
at least one side has transfer/payment language
account type pairing is plausible
```

## Confidence Score

Suggested score model:

```text
amount exact match: +40
amount within tolerance: +30
same day: +25
within 1-2 days: +15
within 3-5 days: +8
checking/savings -> credit: +25
checking <-> savings: +20
keyword payment/autopay/transfer: +20
same institution/account naming hint: +5
```

Thresholds:

```text
score >= 75:
  auto match

score 50-74:
  suggest match to user

score < 50:
  do not match
```

## Output Behavior

When auto-matched:

```text
transaction_kind = transfer
budget_behavior = exclude_as_transfer
transfer_group_id = shared group id
transfer_match_status = auto_matched
transfer_match_confidence = score
transfer_match_reason = short explanation
```

When suggested:

```text
transaction_kind may be transfer or normal depending on confidence
budget_behavior should be conservative
transfer_match_status = suggested
```

For suggested matches, avoid changing budget totals too aggressively until user confirms.

## User Rejection

If user rejects a suggested match:

```text
transfer_match_status = ignored
```

System should not repeatedly suggest the same pair.

## Manual Matching

Users should be able to manually select a matching transaction.

Manual match result:

```text
transfer_match_status = manually_matched
budget_behavior = exclude_as_transfer
```

## Important Edge Cases

### Single-sided transfer

Sometimes only one account is linked.

Example:

```text
Checking -500 credit card payment
```

If the credit card account is not linked, there is no matching positive leg.

Still treat it as transfer if the evidence is strong, but status should remain:

```text
unmatched
```

### Split payments

A single payment may cover multiple credit card transactions. Do not try to match against purchases. Match against the credit card payment received leg, not individual card purchases.

### External payment to merchant

Do not confuse bill payment to a vendor with internal transfer.

Example:

```text
Utility Bill Payment
Rent Payment
Insurance Payment
```

These are expenses unless there is clear internal account evidence.
