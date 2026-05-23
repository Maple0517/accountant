# Credit Card Payments

## Purpose

Prevent credit card payments from double-counting spending.

## Core Product Rule

Credit card purchase is spending.

Credit card repayment is not spending.

Example:

```text
Credit Card +100 Grocery Purchase
Checking +100? / -100 depending convention Credit Card Payment
Credit Card payment received
```

Using Accountant's Plaid amount convention:

```text
Credit card purchase:
  amount = positive
  transaction_kind = normal
  budget_behavior = count_as_spending

Checking payment out:
  transaction_kind = transfer
  budget_behavior = exclude_as_transfer

Credit card payment received:
  transaction_kind = transfer
  budget_behavior = exclude_as_transfer
```

## Why This Matters

If the credit card purchase and later repayment both count as spending, user spending is doubled.

Correct behavior:

```text
Buy groceries with credit card: spending +100
Pay card bill from checking: spending +0
```

## Detection Rules

Credit card payment detection should use:

- Account type
- Transaction name/description
- Amount/date matching
- Direction
- Transfer matching

Strong signals:

```text
credit card payment
payment received
online payment
autopay
thank you
card payment
```

Account type signal:

```text
checking/savings outflow + credit inflow
```

## Product States

### Matched credit card payment

Both legs are visible and grouped.

User sees:

```text
Transfer · Matched to Chase Credit Card
```

Budget:

```text
excluded from spending and income
```

### Unmatched credit card payment

Only one side is visible because not all accounts are linked.

User sees:

```text
Transfer · Unmatched
```

Budget:

```text
excluded from spending and income if confidence is high
```

### Suggested credit card payment

System is not confident.

User sees:

```text
Possible credit card payment
Confirm / Not a transfer
```

Budget:

Prefer conservative behavior. If the text strongly says credit card payment, exclude as transfer. If ambiguous, do not auto-exclude.

## Historical Credit Card Debt

This is a separate product case.

If the user starts using Accountant with existing credit card debt, payments may represent monthly debt repayment rather than current spending already tracked in the app.

Example:

```text
Before connecting Accountant:
  credit card already has $5,000 balance

After connecting:
  user pays $500 per month
```

If all payments are excluded as transfers, budget does not reflect monthly debt burden.

## Recommended UI Option

In transaction detail:

```text
Is this payment paying down existing debt?
```

If yes:

```text
checking side:
  transaction_kind = transfer
  budget_behavior = count_as_spending
  category = Debt Payment

credit card side:
  transaction_kind = transfer
  budget_behavior = exclude_as_transfer
```

Important:

Only one side should count as spending.

## Recommended Default

Default credit card payments to transfer exclusion.

Only count as Debt Payment when:

- User explicitly chooses it.
- Or future onboarding indicates existing debt should be budgeted.

## Acceptance Criteria

1. Credit card purchase counts once.
2. Credit card repayment does not count as new spending.
3. Credit card payment received is not income.
4. Historical debt payment can intentionally count as spending.
5. User can see why a payment was excluded.
