# Migration and Backfill Strategy

## Purpose

Introduce transaction semantics safely without corrupting existing user reports.

## Migration Goals

Add transaction-level budget behavior and transfer matching fields.

Recommended additions:

```text
budget_behavior
transfer_group_id
transfer_match_status
transfer_match_confidence
transfer_match_reason
semantic_override_source
```

`semantic_override_source` is optional but recommended.

## Safe Defaults

Backfill existing transactions conservatively.

Suggested mapping:

```text
transaction_kind = transfer:
  budget_behavior = exclude_as_transfer

transaction_kind = refund:
  budget_behavior = count_as_spending

transaction_kind = reimbursement:
  budget_behavior = count_as_spending by default

category.type = income:
  budget_behavior = count_as_income

category.type = expense:
  budget_behavior = count_as_spending

category.type = transfer:
  budget_behavior = exclude_as_transfer

category.is_excluded_from_budget = true:
  budget_behavior = exclude_manual or exclude_as_transfer
```

When unclear, prefer preserving current behavior over making aggressive changes.

## Backfill Order

Recommended sequence:

1. Add new nullable fields.
2. Backfill `budget_behavior` using existing category and transaction_kind.
3. Add indexes/check constraints.
4. Update budget logic to use `budget_behavior` when present.
5. Keep fallback to old category logic temporarily.
6. Run transfer detection on recent transactions first.
7. Expand transfer detection to all history after validation.
8. Remove fallback only after stable.

## Transfer Backfill

Do not aggressively classify old transactions without visibility.

Recommended rollout:

```text
Phase A:
  detect only very high-confidence transfers.

Phase B:
  mark medium-confidence transfers as suggested.

Phase C:
  expose review UI.

Phase D:
  allow user rules for future automation.
```

## User Overrides

Manual user choices must survive Plaid sync and AI classification.

When backfilling, do not overwrite transactions that have evidence of manual edits.

## Reporting Risk

Changing budget behavior can alter historical charts.

Mitigation:

- Start with conservative mapping.
- Avoid changing refund behavior if it already works.
- Log or surface changed transaction count.
- Consider an admin/debug page for before/after totals during development.

## Rollback Considerations

A rollback should be possible by:

- Ignoring `budget_behavior` and using old category logic.
- Ignoring transfer matching fields.
- Keeping the added columns harmless.

Do not remove existing refund fields.

## Acceptance Criteria

1. Existing transactions remain visible.
2. Existing refund behavior does not regress.
3. Budget totals do not unexpectedly swing due to low-confidence transfer backfill.
4. New fields are populated for future transactions.
5. Old logic can still operate during transitional rollout.
