# Fee vouchers, optional (enrollment-based) fees, per-fee discounts — plan

Status (2026-11-26): **Phase 1 built, uncommitted.** Migration `schools/0023_school_finance_config` applied to scratch SQLite
and to Supabase (2026-11-26, user approved).
**Phase 2 built 2026-11-26, uncommitted.** Migration `finance/0032_optional_fee_enrollments` applied to scratch
SQLite and to Supabase (2026-11-26, user approved).

**Phase 3 built 2026-11-26, uncommitted.** Migration `finance/0033_discounts_per_fee_type` applied to scratch SQLite
and to Supabase (2026-11-26, user approved).
Phase 3 code map: `finance/fee_discounts.py` (rules_for + apply: % / fixed per bill / full; non-stackable stands
alone, stackable + scholarships add, best option wins, capped at the charge). Stored as NET charge:
`base_monthly_fee` / annual `amount_due` are after discount, `FeePayment.discount_amount` + `discount_detail` say
what came off, so ledger/balances/Kuickpay are untouched. Applied in `plan_scope_records` (monthly + annual tasks,
preview), `generate_single`, `class_move_fees.reprice_months`; not in admissions (no assignment yet) or one-time
fees (no category). Discount/Scholarship get `monthly_categories` / `annual_categories` (none = cuts nothing, so old
discounts stay inert). Fee breakdown endpoint is per fee type. Vouchers show full fee + "Less: discount".
Web: `finance/FeeTypePicker.jsx` in both forms (required), "On: ..." / "No fees picked" labels, fee table note.
Mobile: `FeePicker` in `DiscountsScreen`, required in `services/discounts.ts`. Tests: `finance/test_fee_discounts.py`
(16), updated `DiscountsPage.test.jsx`, `mobile/__tests__/discounts.test.ts`.
Bills already generated keep their amounts; regenerate with "update" to apply a discount to them.

Phase 2 code map: `finance/optional_fees.py` (period/overlap/price rules), `generation_planner.plan_scope_records`
(enrolled-only branch, `not_enrolled` count; tasks pass year/month/academic year), `resolve_fee_amount` (year/month
args), admissions guard, `class_move_fees._fee_for`, `StudentFeeEnrollmentViewSet` (`fee-enrollments/`,
`bulk_enroll/`, `end/`), category serializers (`billing_mode`, `default_amount`, `enrolled_count`). Web
`OptionalFeeModal.jsx` opened from "Billing"/"Students" in both category managers; generation preview/result show
not-enrolled. Mobile `FeeEnrollmentsSheet.tsx` + switch/price in `CategoriesScreen`. Tests:
`finance/test_optional_fees.py` (15), `OptionalFeeModal.test.jsx` (4), `mobile/__tests__/feeEnrollments.test.ts` (8).
Default price is only read for ENROLLED categories (an ALL category still needs class prices).

Phase 1 code map: `backend/finance/vouchers.py` (totals + reportlab PDF), `FeePaymentViewSet.vouchers`
(`GET fee-payments/vouchers/`, teachers allowed for their sections), `FeeVoucherSettingsView`
(`GET/PUT voucher-settings/`, admins write), web `fee-collection/VoucherModal.jsx` + "Print Vouchers" button,
mobile `services/feeVouchers.ts` + vouchers button in `FeeCollectScreen`. Tests: `finance/test_fee_vouchers.py` (16),
`VoucherModal.test.jsx` (4), `mobile/__tests__/feeVouchers.test.ts` (5).
Deviation from plan: no background task for whole-school printing (reportlab canvas is fast; add one if a big
school times out).

## What the code does today (findings)

- Fee types: `MONTHLY` / `ANNUAL`, each with school categories (`MonthlyFeeCategory`, `AnnualFeeCategory`).
- Amounts: `FeeStructure`, class level or student level (student wins). Generation (`finance/tasks.py`,
  `generation_planner.py`) bills every student who resolves an amount; one `FeePayment` per student/category/month.
- Monthly rows carry unpaid balance forward **per category**: `amount_due = previous_balance + base_monthly_fee`
  (`ledger.carry_in_balances`). Annual rows (month=0) are not carried.
- **Discounts are never applied to bills.** No generation path reads `StudentDiscount`; `FeePayment` has no
  discount field. Discounts only show in the read-only fee-breakdown endpoint (`views.py` ~4140), which prices the
  student with an uncategorised `resolve_fee_amount(student)` and takes % off that. Sibling confirmation creates
  `StudentDiscount` rows that also never reduce a bill.
- No voucher/challan anywhere (web or mobile). Kuickpay has `KuickpayBill.consumer_number` per student per cycle.

## User decisions (2026-11-26)

1. Voucher: **2 copies per student — School copy + Student copy**, side by side.
2. Voucher shows **all unpaid dues**: previous unpaid + current month = total payable.
3. If the school has Kuickpay, print the **Kuickpay voucher (consumer) number**.
4. Discounts must be **per fee type/category**, not per student overall.
5. Joining mid-month = **full month fee**.

## More decisions (2026-11-26, round 2)

- Due date is a **per-school finance setting**.
- Voucher shows **school bank details and Kuickpay number, in separate boxes**.
- Discounts can apply to **any fee type, monthly or annual**, including optional fees.

## Discount data today (read-only scan of Supabase, 2026-11-26)

| School | Discounts defined | Students assigned |
|---|---|---|
| Focus Branch 1 | Sibling 50% | 0 |
| Focus Branch 2 | none | 0 |
| Demo School | Sibling 10%, Merit scholarship 25% | 1 + 1 |
| SEED_TEST_School_Alpha (test) | 2 sibling 10%, 2 merit | 13 + 4 |

No real school has a discount assigned, and none ever reduced a bill. Focus uses **student-level fee
overrides** instead (Branch 1: 255, Branch 2: 180 active), probably entering the reduced amount directly.
Phase 3 must not stack a discount on top of an already-reduced override without the school knowing.

## Phase 1 — Fee vouchers (one small migration)

- New `School.finance_config` JSON (same pattern as `exam_config`, `attendance_config`): `due_day` (1-28),
  `voucher_bank_account_id` (a Bank `Account`), optional `voucher_note`. Edited under Finance settings.
  `KuickpaySchoolMapping.due_day` already exists; the school setting becomes the one place to edit and is
  copied to the Kuickpay mapping so the bank and the paper voucher never show different due dates.
- Voucher: separate "Pay at bank" box (bank, account title, account no., IBAN) and "Pay via Kuickpay" box
  (consumer number) shown only when Kuickpay is on for the school.

- Layout: A4 portrait, each student = one strip with School copy | Student copy, dashed cut lines.
  **3 students per page** (strip ~99 mm tall). If a student has many fee lines the strip grows.
- Content per copy: school name/logo, copy label, voucher no. (Kuickpay consumer no. when present, else
  `YYYYMM-studentId`), student, father, class-section, roll, month, issue/due date, one line per category
  (current charge), previous unpaid, discount (once Phase 3 lands), **total payable**, signature/stamp box.
- Totals: current month rows give `base_monthly_fee` and `previous_balance` per category (no double count of
  older monthly rows, since their balance is already carried in); plus unpaid annual/one-time rows. Must be
  checked against `student_balance.student_pending_fees` before building.
- Server: `GET /api/finance/fee-vouchers/pdf/?year&month&class_id|session_class_id|student_ids&only_unpaid=1`,
  reportlab (existing Urdu shaping), finance-access only; whole school via `dispatch_background_task`.
- Web: "Print vouchers" on Fee Collection (uses current filters) + per-row print.
- Mobile: "Vouchers" action on admin fee-collection, download + share/print.
- Later: parent/student download own voucher.

## Phase 2 — Optional (enrollment-based) fees (migration)

- Category flag `billing_mode`: `ALL` (today) / `ENROLLED` — on both category tables, + `default_amount`.
- New `StudentFeeEnrollment`: student, category (monthly or annual FK), academic_year, start month, end month
  (null = ongoing), optional amount, created_by.
- Price: enrollment amount > student FeeStructure > class FeeStructure > category default_amount.
- Generation: ENROLLED categories bill only students enrolled in that month (full month, decision 5); never use
  the legacy `monthly_category=NULL` fallback; preview counts "not enrolled" separately.
- Web: Billing toggle in category managers, "Enrolled students" screen per category (class filter, bulk
  enroll/end), optional fees on student profile. Mobile: toggle + enroll/end list.

## Phase 3 — Per-fee discounts (migration, changes real bills)

- `Discount` and `Scholarship` get M2M `monthly_categories` / `annual_categories` (which fees they cut).
- `FeePayment` gets `discount_amount` (+ small JSON of which discounts) so bills and vouchers show it.
  `amount_due = previous_balance + base_fee - discount_amount`.
- All generation paths (monthly, annual, one-time, single) apply active `StudentDiscount`s whose discount covers
  that category and date; non-stackable = biggest one wins; never below 0.
- Fee-breakdown endpoint becomes per category. Discount form gets an "Applies to fees" multi-select (web + mobile).
- Already generated bills are left alone; re-applying = existing regenerate with `update` strategy.

## Open questions

- Late fee: none for now, or a fixed amount printed as "after due date"?
- Existing discount rows: built as recommended: they have no fee types and cut nothing until a school edits them.

