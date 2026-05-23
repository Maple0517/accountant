# Transaction UI Behavior

## Purpose

Make transaction semantics understandable and editable by users.

This is important because automatic systems will never classify every transaction perfectly.

## Transaction Row Badges

Add compact semantic badges:

```text
Normal
Refund
Reimbursement
Transfer
Excluded
```

For transfer status:

```text
Transfer · Matched
Transfer · Suggested
Transfer · Unmatched
```

For refund status:

```text
Refund · Linked
Refund · Unmatched
```

For manual exclusion:

```text
Excluded
```

## Transaction Detail Treatment Section

Add a section:

```text
How should this transaction be handled?
```

User-facing options:

```text
Count as spending
Count as income
Treat as transfer
Exclude from reports
```

Do not expose database values as the main UI.

## Advanced Section

Show advanced details behind a smaller section:

```text
Transaction kind
Budget behavior
Budget date
Linked transaction
Transfer match status
Match confidence
Match reason
```

This helps debugging without overwhelming normal users.

## Credit Card Payment UX

For a detected credit card payment:

```text
This looks like a credit card payment.
It is excluded from spending to avoid double counting.
```

Actions:

```text
Confirm
Not a transfer
Count as debt repayment
```

## Historical Debt UX

For credit card payments:

```text
Count this payment as existing debt repayment?
```

If enabled:

```text
This will count the checking-side payment in your budget under Debt Payment.
The credit card-side payment will remain excluded.
```

## Transfer Matching UX

For suggested transfer:

```text
Possible matching transfer found
```

Display:

```text
This transaction
Possible match
Amount
Date
Account
Confidence
```

Actions:

```text
Confirm match
Reject match
Find another match
```

## Refund UX

For refund:

```text
This looks like a refund.
```

Display:

```text
Linked original purchase
Budget month affected
Category inherited
Confidence
```

Actions:

```text
Change linked transaction
Unlink
Treat as income
Exclude
```

## Reimbursement UX

For reimbursement:

```text
How should this reimbursement be handled?
```

Options:

```text
Offset original expense
Count as income
Exclude from reports
```

## Manual Override Behavior

When user changes semantic treatment:

```text
Do not overwrite this transaction automatically in future syncs.
```

Optional prompt:

```text
Apply this behavior to similar future transactions?
```

## User Rule Prompt

After manual override, optionally offer:

```text
Always treat similar transactions this way?
```

Examples:

```text
Always treat "CHASE CREDIT CARD PAYMENT" as transfer.
Always exclude transactions from this merchant.
Always classify this merchant as Groceries.
```

## UI Acceptance Criteria

1. User can understand why a transaction is excluded from spending.
2. User can manually fix a wrong transfer/refund/reimbursement.
3. User can count a credit card payment as debt repayment.
4. User can reject false transfer matches.
5. User can see linked refund original purchase.
