# Kuickpay Phase A0 — Fee Ledger Impact Analysis

Companion to `docs/KUICKPAY_TECHNICAL_ASSESSMENT.md` (§4.8). Produced before any change to fee generation.
Evidence for "current behaviour" is the characterization suite `backend/finance/test_fee_generation_regression.py` (26 tests, all passing on unmodified code).

## Stages and what they can change

| Stage | Change | Stored-value effect |
|---|---|---|
| F1 | Read-only `ledger.py`, integrity report | none |
| F2 (needs F-1) | Carry-in from the latest prior same-category row instead of only month M-1 | `previous_balance` / `amount_due` of **newly generated** rows, **only where a gap previously dropped a balance** (case R-4) |
| F3 (needs F-8) | Row locks, advisory lock, atomic manual-payment paths | none (removes races) |
| F4 (needs F-2) | `delete_recreate` / `generate_single` delete refuse rows with payments or Kuickpay allocations | rows with `amount_paid > 0` are no longer silently reset to 0 (case R-9) |
| F5 | Admin-triggered chain refresh (same fields as today's `update` mode) | only when an administrator runs it |
| F6 | `amount_paid` cannot drop below confirmed Kuickpay allocations | only rows that have allocations (none exist before Kuickpay is live) |

## Consumers of ledger fields

"Reads" lists the stored fields the consumer uses; "Affected by" is whether F1–F6 can change what it sees.

| Consumer | Reads | Affected by | Notes |
|---|---|---|---|
| `finance/student_balance.py` (`student_pending_fees`, `student_fee_summary`) | `amount_due`, `amount_paid`, `handed_over_to_exit`, latest monthly row per category | F2: yes, in gap cases | Outstanding rises by exactly the balance previously lost. Unchanged elsewhere (R-5 pins "latest row only") |
| `finance/fee_month_summary.py` | `Sum(amount_due)`, `Sum(amount_paid)` per month | F2: yes, in gap cases | A recovered balance appears in that month's total due |
| `finance/fee_risk.py` | `amount_due`, `amount_paid`, `previous_balance`, `base_monthly_fee`, `handed_over_to_exit_id`; computes fresh charge as `amount_due - previous_balance` | F2: yes, in gap cases | Uses the stored split, which F2 keeps consistent |
| `parents/overview.py` | `amount_due`, `amount_paid`, `previous_balance` (overdue = carried part) | F2: yes, in gap cases | Overdue now includes the recovered balance |
| `reports/generators/student.py` (~L750) | `Sum(amount_due)`, uses `base_monthly_fee` for "fresh charge" | F2: gap cases | Already avoids summing carried balances |
| `reports/generators/fee.py` | `amount_due - amount_paid` per row | F2: gap cases | |
| `reports/generators/finance.py` | none of the changed fields | none | |
| `notifications/triggers.py` (L137, L1125) | `amount_due`, `amount_paid` per row | F2: gap cases | Reminder amount rises by the recovered balance |
| `academic_sessions/session_health_service.py` (~L237-310) | `Sum(amount_due)`, `Sum(amount_paid)`, excludes handed-over rows, comments on carry-over double counting | F2: gap cases | Already carry-aware |
| `students/history.py`, `students/timeline.py` | rows as-is, `handed_over` flag | none | Display only |
| `student_exits/transfer.py` | creates carried rows (`previous_balance=balance`, `base_monthly_fee=0`) and sets `handed_over_to_exit` via queryset update | none | Carried rows are "pinned": never regenerated or refreshed (existing rule R-13) |
| `admissions/views.py` (L355) | creates rows with `amount_due`, `amount_paid=0` | none | Creates rows; no carry logic |
| `finance/class_move_fees.py` | rewrites `previous_balance` on unpaid tail rows | none | Detected by the integrity report if it leaves a chain inconsistent |
| `finance/views.py` account balances | `amount_paid`, `payment_date`, `account` | F6 only | Closed-month snapshot floor unchanged |

`core/ai_insights_service.py`, `students/lifecycle.py`, `students/views.py`, `students/ai_service.py`, `academic_sessions/views.py`, `academic_sessions/promotion_advisor_service.py` and `core/bootstrap_views.py` were checked and do not read the changed fields directly (they go through the modules above).

## Conclusions
1. F1, F3, F5 (until run) and F6 do not alter any value an existing consumer reads.
2. F2 changes values only in the R-4 gap case, and only upward by a balance that was previously lost; every consumer above reads fields it already treats as cumulative.
3. F4 changes only the paid-row `delete_recreate` case, which today destroys the payment (R-9).
4. Propagate-on-payment is excluded from release 1 (F-3) because it would change `Sum(amount_due)`-based monthly totals.
5. Discounts and scholarships are not applied by generation (R-19) and are unchanged by this plan (F-5).

## Outcome
F-1, F-2, F-3, F-4 and F-8 were approved and implemented in Phase A2. Cases R-4 and R-9 flipped exactly as predicted (they are now `test_r4_missing_intervening_row_carries_the_balance` and `test_r9_delete_recreate_protects_a_row_with_a_recorded_payment`); the other 24 characterization cases pass unchanged, which confirms the change is limited to the gap and paid-row cases. The D5 queryset-delete test is unchanged because the queryset delete is retained for unprotected rows.
