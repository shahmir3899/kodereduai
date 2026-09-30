# Accounting System Overview

An orientation for developers new to the `finance` app. It explains **how money moves**, **how balances are calculated**, and **what protects the books from being silently changed**. Read this first, then go to the code.

- Code: `backend/finance/` (`models.py`, `views.py`, `tasks.py`, `serializers.py`)
- Permissions: `backend/core/permissions.py` (`FinanceRoleAccessPermission`)
- Related docs: `FINANCE_AUDIT_PERMISSIONS_SUMMARY.md` (edit rules and audit columns), `API_ENDPOINTS.md`

---

## 1. The model in one paragraph

This is a **single-entry, cash-basis ledger with receivables tracking**, not a double-entry general ledger. There are no debit/credit journal lines. Instead:

- **Accounts** (cash boxes, bank accounts, person-held cash) hold money.
- Four kinds of records move money in or out of an account: **fee payments**, **other income**, **expenses**, and **transfers**.
- An account's **balance is never stored as a running total**. It is always *derived* from an opening balance plus the transactions that touch it. The only stored balances are month-end **snapshots**, which exist purely to make the derivation cheaper.

If you remember one thing: **nothing edits a balance; you add or change a transaction and the balance is recomputed.**

---

## 2. Funds flow

```
                 ┌────────────────────────────────────────────┐
   RECEIVABLES   │  FeeStructure ──generate──▶ FeePayment     │
   (what is owed)│  (price list)               amount_due     │
                 └───────────────┬────────────────────────────┘
                                 │ parent pays → amount_paid, payment_date, account
                                 ▼
   ┌───────────────────────────────────────────────────────────────┐
   │                          ACCOUNT                              │
   │   opening_balance (BBF)                                       │
   │     + receipts   = FeePayment.amount_paid + OtherIncome       │
   │     − payments   = Expense                                    │
   │     + transfers in   − transfers out                          │
   │   = net_balance                                               │
   └───────────────────────────────────────────────────────────────┘
        ▲ OtherIncome (donations, sales, events)      │ Expense (salary, rent…)
        └─────────────────────────────────────────────┘
                Transfer: Account A ──▶ Account B  (net zero across the school)
```

| Record | Direction | Affects account via | Requires |
|---|---|---|---|
| `FeePayment` (`amount_paid`) | money **in** | `account` | `payment_date` **and** `account` whenever `amount_paid > 0` |
| `OtherIncome` | money **in** | `account` | `recorded_by` |
| `Expense` | money **out** | `account` | `recorded_by` |
| `Transfer` | out of one, into another | `from_account` / `to_account` | `recorded_by`, different accounts, amount > 0 |

A transfer moves money between accounts without changing the total, which is why `grand_total` across accounts only changes through income, fees, and expenses.

---

## 3. Core concepts

### 3.1 Account (`Account`)
Types: `CASH`, `BANK`, `PERSON` (money held by an individual, e.g. a principal or owner).

- **Scope.** An account belongs to one school (`school` set) or is **shared across an organization** (`school` null, `organization` set). Shared accounts total transactions from *every* school in the org; school accounts only from their own school.
- `opening_balance` is the **BBF (Beginning Balance Forward)**: the balance before the first recorded transaction.
- `staff_visible` and `account_owner` control who can see the account (see section 6).
- Names are unique per school (or per org for shared accounts).

### 3.2 Fees: the receivable side
- **`FeeStructure`** is the price list. A class-level fee applies to everyone in a grade; a **student-level** structure overrides it. Resolution (`resolve_fee_amount`): student fee, else class fee, both filtered by `effective_from`/`effective_to`. The class is taken from the student's enrollment for the relevant academic year, not from `Student.class_obj`, so promoted students are not re-priced retroactively.
- Fee types: `MONTHLY` (categorized by `MonthlyFeeCategory`, e.g. Tuition, Transport) and `ANNUAL` (categorized by `AnnualFeeCategory`, e.g. Lab Fee). `ADMISSION`, `BOOKS`, and `FINE` are deprecated and exist only for old data.
- **`FeePayment`** is one row per student, period, and category. It is both the *bill* (`amount_due`) and the *receipt* (`amount_paid`). Uniqueness is enforced by database constraints, so re-running generation cannot create duplicates.

### 3.3 Fee status is derived, never typed in
`FeePayment.compute_status()` is the single source of truth:

| Condition | Status |
|---|---|
| `amount_due == 0` and `amount_paid == 0` | `PAID` |
| `amount_due <= 0` (covered by a prior advance) | `ADVANCE` |
| `amount_paid >= amount_due` | `PAID` |
| `0 < amount_paid < amount_due` | `PARTIAL` |
| otherwise | `UNPAID` (and `payment_date`, `account`, `receipt_number` are cleared) |

`save()` calls it, and the bulk generator calls it directly before `bulk_update()` (which skips `save()`). **Do not re-implement this rule elsewhere.**

### 3.4 Carry-forward (arrears)
Monthly generation computes:

```
previous_balance = last month's (amount_due − amount_paid)   # same student + category
amount_due       = previous_balance + base_monthly_fee
```

`base_monthly_fee` is stored so `amount_due` can be reconstructed if it is later overridden. Because the balance rolls forward month to month, an unpaid month shows up again in the next bill. This is how arrears are tracked; there is no separate arrears table.

Generation (`POST fee-payments/generate_monthly/`) is idempotent and takes a `conflict_strategy`:
- `skip` (default): leave existing rows alone.
- `update`: refresh amounts, but **never** if `amount_paid` already exceeds the new `amount_due` (protected).
- `delete_recreate`: replace the row.

It runs synchronously for fewer than 100 students and as a background task otherwise (`core.BackgroundTask`).

### 3.5 Discounts and scholarships
`Discount` (percentage or fixed) and `Scholarship` (full, percentage, or fixed coverage) are assigned to students per academic year through `StudentDiscount`, recording who approved and when. The breakdown endpoint `fee-breakdown/<student_id>/` shows `base_amount − discounts = final_amount`, floored at zero. Confirm how discounts feed into generated `amount_due` before relying on them in a new feature. The bulk generator in `tasks.py` works from the fee structure amount.

---

## 4. How an account balance is computed

`AccountViewSet._compute_account_balance` (`views.py`):

```
net_balance = opening_balance
            + Σ FeePayment.amount_paid  (account = this)
            + Σ OtherIncome.amount      (account = this)
            − Σ Expense.amount          (account = this)
            + Σ Transfer.amount         (to_account = this)
            − Σ Transfer.amount         (from_account = this)
```

with the date filters applied to `payment_date` (fees) or `date` (everything else).

### Snapshot optimization
Summing all history on every request gets slow. When a month is closed, the balance at month end is stored in `AccountSnapshot`. Later queries:
1. Find the latest snapshot **strictly before** the requested period.
2. Use its `closing_balance` as the starting balance.
3. Sum only transactions **after** the snapshot's last day.

If a `date_from` falls after the snapshot end, the transactions in the gap are folded into the opening balance, so the displayed columns still show only the requested period.

### Subtle behaviors worth knowing
- With **no snapshot**, fee payments with a NULL `payment_date` are included (they are real money). **With a snapshot** they are excluded, because they were already counted or blocked at close time.
- Non-admin ("staff") views exclude anything marked `is_sensitive`, so **their balances legitimately differ from the admin's**.
- Reports (`balances`, `ledger`, `export-ledger`, `export-ledger-pdf`, `balances_all`) all go through this one function. Keep it that way so numbers cannot diverge between screens.

---

## 5. Integrity controls (what makes it "solid")

| # | Control | Where | Effect |
|---|---|---|---|
| 1 | **Payment completeness** | `FeePayment.save()` | Money received requires `payment_date` and `account`. |
| 2 | **Period locking** | `save()` and `delete()` on `FeePayment` (monthly), `Expense`, `OtherIncome`, `Transfer` | Any write into a closed month raises `ValidationError`. Enforced at the model layer, so it applies to every code path, not just the API. |
| 3 | **Audit trail** | `save()` on `Expense`, `OtherIncome`, `Transfer` | `recorded_by` is mandatory. `FeePayment` records `collected_by`. |
| 4 | **Pre-close validation** | `close_month` | Refuses to close if any payment has `amount_paid > 0` but no account or date, or if the month has no transactions at all. |
| 5 | **Atomic close** | `close_month` | Closing record and every account snapshot are written in one `transaction.atomic()`. |
| 6 | **Edit ownership** | ViewSets | Only admins or the original recorder can edit or delete an entry (see `FINANCE_AUDIT_PERMISSIONS_SUMMARY.md`). |
| 7 | **Referential safety** | `Expense.category` and `OtherIncome.category` use `on_delete=PROTECT` | A category with history cannot be deleted. |
| 8 | **Tenant isolation** | serializers and querysets | Accounts and categories must belong to the caller's school; every queryset is school-scoped. |
| 9 | **Decimal money** | all amount fields | `DecimalField` everywhere, never floats. |

### The month-end close cycle

```
close_month(year, month)          reopen_month(closing_id)
   │  validate (no dirty payments,    │  deletes MonthlyClosing
   │  has transactions)               │  (snapshots cascade)
   ▼                                  ▼
 MonthlyClosing + AccountSnapshot   Month is editable again;
 rows created; month is LOCKED      balances fall back to older
                                    snapshot or opening_balance
```

Closing and reopening are **admin-only** (`IsSchoolAdmin`). Closing an already-closed month recomputes and replaces its snapshots.

---

## 6. Who can do what

| Role | Access |
|---|---|
| `SUPER_ADMIN`, `SCHOOL_ADMIN`, `PRINCIPAL` | Full access. `PRINCIPAL` sees only their own school's accounts, not org-shared ones. |
| `ACCOUNTANT`, `DRIVER` | Read-only. |
| `TEACHER` | Only fee collection for assigned classes, plus reading accounts and categories. |
| `STAFF`, `MANAGER` | No finance access. |

Visibility layers on top of role:
- `Account.staff_visible` and `account_owner`: non-admins see only visible accounts or ones they own.
- `is_sensitive` on `Expense`, `OtherIncome`, `Transfer`, and `ExpenseCategory` hides entries from staff views and from staff balance calculations.

The role table above reflects `FinanceRoleAccessPermission` at the time of writing. Check `core/permissions.py` if it has changed.

---

## 7. Known limits (read before extending)

Being honest about these will save you a bad assumption:

1. **Not double-entry.** There is no chart of accounts, no journal, and no automatic trial balance. Fee income is recognized when received (cash basis); `amount_due` is a receivable *tracker*, not a booked asset.
2. **One row is both bill and receipt.** A `FeePayment` holds a single `amount_paid`, `payment_date`, and `account`. Multiple partial payments overwrite these fields rather than creating separate receipt lines, so per-installment history is not preserved in this table.
3. **Annual fees are not period-locked.** They use `month = 0`, so the closed-month check is skipped for them. A backdated annual payment can change a closed month's balance without a new close. Treat this as a gap.
4. **Reopen has no ordering guard.** Reopening an early month while later months stay closed leaves later snapshots computed from the old data. If you reopen a month, re-close every month after it.
5. **Online payments are discontinued.** `PaymentGatewayConfig`, `OnlinePayment`, and the JazzCash/Easypaisa callbacks return HTTP 410. Do not build on them. See `backend/finance/_deprecated_payment_gateway/README.md`.
6. **Class scoping.** Fee structures are deliberately per **master class** (grade), not per section. Per-section differences are handled with student-level overrides.

---

## 8. Where to start when changing something

| If you are touching… | Read first |
|---|---|
| Balances, ledger, or reports | `_compute_account_balance` and `test_account_snapshot_boundary.py` |
| Closing or locking | `close_month`, `MonthlyClosing`, and the `save()` methods in `models.py` |
| Fee generation | `finance/tasks.py::generate_monthly_fees_task` and `generation_planner.py` |
| Fee status logic | `FeePayment.compute_status` (change it in one place only) |
| Permissions | `FinanceRoleAccessPermission` and `FINANCE_AUDIT_PERMISSIONS_SUMMARY.md` |
| Transfer rules | `TransferCreateSerializer` and `test_transfer_serializer.py` |

**Rules of thumb for new code**
- Add money movement as a new record type tied to an `account`, then include it in `_compute_account_balance` **and** in `close_month` (which reuses the same function).
- Guard every new write path with the period-lock check and require `recorded_by`.
- Never store a balance you can derive. Add a snapshot only if you can also rebuild it.
- Add or extend a test in `backend/finance/`. Use the shared seed data described in the test conventions, not a per-test school.
