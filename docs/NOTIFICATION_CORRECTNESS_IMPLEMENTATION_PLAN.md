# Notification Correctness Implementation Plan

## Goal
Ensure every notification trigger is correct, deterministic, and consistent with UI/settings across:
- Event-driven triggers
- Scheduled triggers
- Recipient resolution
- Dedupe/idempotency
- Failure visibility and retries

## Trigger Inventory To Cover
1. Absence event trigger in `backend/notifications/triggers.py`
2. Fee reminders in `backend/notifications/triggers.py`
3. Fee overdue in `backend/notifications/triggers.py`
4. Exam result in `backend/notifications/triggers.py`
5. General announcement in `backend/notifications/triggers.py`
6. Class teacher attendance pending in `backend/notifications/triggers.py`
7. Class teacher fee pending in `backend/notifications/triggers.py`
8. Lesson plan published in `backend/notifications/triggers.py`
9. Daily school report in `backend/notifications/triggers.py`
10. Transport notifications in `backend/transport/triggers.py`
11. Scheduled task orchestration in `backend/notifications/tasks.py`
12. Beat schedule alignment in `backend/config/settings.py`

## Known Risk Areas (Current)
1. Broken parent mapping in transport trigger path:
   - `backend/transport/triggers.py` uses `student.parent` patterns, while parent linkage is via `ParentChild`.
2. Broken student account mapping in lesson plan trigger path:
   - `backend/notifications/triggers.py` uses `student.user`; project linkage is via `StudentProfile` (`student.user_profile.user`).
3. Daily summary/report naming + toggle/schedule mismatch:
   - UI label says Daily Absence Summary and shows configurable time.
   - Toggle updates `daily_report_enabled`.
   - Scheduler runs fixed 17:00 task (`send_daily_absence_summary`) that dispatches `trigger_daily_school_report`.
4. Missing idempotency in some scheduled/consolidated triggers:
   - Daily report can duplicate if task retried/manual run.
   - Class teacher fee pending can duplicate if task reruns.
5. Multi-school recipient resolution inconsistency:
   - Some paths still use `User.school` role filters instead of membership model (`UserSchoolMembership`).

## Phase A: Recipient Correctness Standardization
1. Introduce shared recipient resolver utility for:
   - Admin/principal via memberships
   - Teacher via assignments + linked user
   - Parent via ParentChild + ParentProfile user
   - Student via StudentProfile user
2. Replace direct `User.school` role filters where multi-school memberships should be authoritative.
3. Fix transport parent resolution to ParentChild model path.
4. Fix lesson plan student user resolution to StudentProfile.

## Phase B: Idempotency and Dedupe Policy
1. Define trigger-by-trigger dedupe keys:
   - event_type, channel, recipient_user, subject entity, date/window
2. Apply per-recipient dedupe consistently for triggers that can repeat:
   - Daily report
   - Class teacher fee pending
   - Transport push events when duplicate geofence calls occur
3. Add explicit dedupe windows:
   - Daily triggers: once per recipient per day
   - Monthly triggers: once per recipient per month
   - Event triggers: once per entity-event transition

## Phase C: Settings and Scheduler Consistency
1. Align UI labels with backend behavior for daily summary/report:
   - Either rename UI to Daily School Report
   - Or restore true absence-only summary behavior
2. Make `fee_reminder_day` and `daily_absence_summary_time` either:
   - Actually used by scheduler, or
   - Removed/hidden from UI if intentionally fixed schedule
3. Ensure all toggles map 1:1 with effective backend flags.

## Phase D: Failure Handling and Observability
1. Standardize logging with reason codes:
   - `skipped_due_to_config`
   - `skipped_due_to_missing_profile`
   - `skipped_due_to_dedupe`
   - `failed_dispatch`
2. Extend NotificationLog metadata for skipped/failed rationale where possible.
3. Add admin diagnostics endpoint/report for "why not sent" visibility.
4. Verify retry task handles only retriable failures.

## Phase E: Test Coverage Matrix
1. API-level tests for each trigger recipient correctness.
2. Idempotency tests for repeated task execution and repeated event save.
3. Multi-school membership tests for recipient resolution.
4. Toggle-on/off behavior tests per trigger.
5. Scheduler contract tests for day/time behavior.
6. Regression tests for:
   - Transport parent mapping
   - Lesson plan student mapping
   - Daily report duplicate suppression
7. Keep and expand current absence tests in `backend/tests/test_attendance_absence_notifications.py`.

## Acceptance Criteria
1. No missed recipients when valid profiles exist.
2. No cross-recipient suppression from global dedupe.
3. No duplicate notifications outside defined windows.
4. UI settings truthfully represent runtime behavior.
5. Trigger tests pass in CI on canonical DB backend.
6. Clear skip/failure reasons are visible in logs/diagnostics.

## Suggested Delivery Order
1. Phase A recipient fixes
2. Phase B dedupe policy
3. Phase C UI/scheduler alignment
4. Phase D observability
5. Phase E full test pack + rollout checklist

## Notes From Current Session
- Absence recipient expansion implemented and validated via API-level test:
  - Admin + class teacher + parent profile + student profile
- Full module test file passed:
  - `backend/tests/test_attendance_absence_notifications.py`
- `--nomigrations` currently required for local sqlite pytest flow due to unrelated migration SQL compatibility issue.
- Phase A recipient resolver utility added:
   - `backend/notifications/recipients.py`
   - Membership-based admin resolution
   - ParentChild-based parent resolution
   - StudentProfile-based student user resolution
- Trigger correctness updates applied:
   - Lesson plan trigger now resolves student users via StudentProfile path
   - Transport triggers now resolve parents via ParentChild path
   - General trigger recipient discovery moved to membership-based resolution
- Phase B dedupe starter policy implemented in key repeatable triggers:
   - Daily report: per-recipient/day dedupe
   - Class teacher fee pending: per-recipient/month dedupe
   - Lesson plan published: per-recipient/day dedupe
   - Transport updates: per-recipient/student/day dedupe
   - Dedupe ignores FAILED logs to allow legitimate retries
- New regression test file added and passing:
   - `backend/tests/test_notification_correctness_triggers.py`
- Phase C scheduler/settings consistency implemented:
   - `send_fee_reminders` now enforces per-school `fee_reminder_day` at runtime
   - `send_daily_absence_summary` now enforces per-school `daily_absence_summary_time` at runtime
   - Daily report task also respects `daily_report_enabled` toggle before dispatch
   - Beat schedule aligned to runtime gating:
      - Fee reminders run daily at 09:00 and execute only for due schools
      - Daily summary task runs every minute and executes only for schools due at current HH:MM
- Scheduler contract tests added and passing:
   - `backend/tests/test_notification_scheduler_contract.py`
- Phase D observability/failure handling implemented:
   - New shared helpers added in `backend/notifications/observability.py`:
      - Standard reason codes
      - Metadata merge utility
      - Failure/retry helpers (`mark_log_failed`, `should_retry_log`, `bump_retry_count`)
   - Queue and scheduled dispatch paths now write standardized failure metadata.
   - Retry processor now retries only retriable failed logs.
   - Admin diagnostics endpoint added:
      - `/api/notifications/diagnostics/`
      - Includes queue snapshot, failed counts by reason code, retry eligibility summary, config blockers, and recent failures.
- Phase D tests added and passing:
   - `backend/tests/test_notification_phase_d_observability.py`
   - Verifies diagnostics payload + permission enforcement.
   - Verifies retriable-only retry behavior in queue processor.
- Combined notification correctness suites passing locally:
   - `backend/tests/test_notification_phase_d_observability.py`
   - `backend/tests/test_notification_scheduler_contract.py`
   - `backend/tests/test_notification_correctness_triggers.py`
- Phase E test coverage matrix expansion completed:
   - Added `backend/tests/test_notification_phase_e_matrix.py` with coverage for:
      - Multi-school membership recipient resolution
      - Membership-scoped `trigger_general` recipient correctness
      - Class-teacher fee pending reminder idempotency for repeated runs
      - Toggle-off behavior for class-teacher fee reminders
- Phase E implementation hardening:
   - Added date-agnostic dedupe helper in `backend/notifications/triggers.py`
   - Applied it to class-teacher fee reminders so repeated task runs do not resend identical reminders.
- Latest focused verification run passed:
   - `backend/tests/test_notification_phase_d_observability.py`
   - `backend/tests/test_notification_phase_e_matrix.py`
   - Result: 7 passed
