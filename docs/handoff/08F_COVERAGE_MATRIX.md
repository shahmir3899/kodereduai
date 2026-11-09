# Item F: coverage matrix (module x entity x Aura tool)

Built 2026-11-09 from the Django models of each app and the tool registry (`assistant/skills/*`). Status: **covered** (a read or write tool exists),
**added** (built in this item, `assistant/skills/coverage_reads.py`), **gap** (useful, not built), **later** (another backlog item owns it), **won't do** (decided, reason given).
Reads are capped (40 rows) and go through the app's own views, so the app's role and tenant rules apply.

| Module | Entity | Status | Tool or reason |
|---|---|---|---|
| **students** | Student | covered | `find_student`, `get_student_profile`, `list_students`, `count_students`, `update_student` |
| | Class / section | covered | `find_class`, `reclassify_student`; class audit in `08A_CLASS_AUDIT.md` |
| | Student documents | **added** | `list_student_documents` (links stay in the app) |
| | Student profile / invite (portal accounts) | won't do | account creation and invites are the office's screen (security) |
| **admissions** | Enquiry, notes | covered | `list_enquiries`, `get_enquiry`, `count_enquiries`, add / note / status / convert writes |
| **academic_sessions** | Academic year, term | **added** | `get_academic_years` |
| | Enrolment, placement | covered | inside student tools (`get_student_profile`, `list_students`) |
| | Promotion operation / event | gap | bulk promotion stays on its screen (owner decision); a read of the last promotion run is possible later |
| | School calendar entries | gap | "is Monday a holiday?" read; small |
| | Risk snapshots (attendance / academic risk) | covered | `get_at_risk_students` |
| **academics** | Subject, class-subject, class teacher | covered | `get_class_info`, `get_curriculum_gaps` |
| | Timetable | covered (read) | `get_class_schedule`, `get_teacher_schedule`, `get_free_teachers`, `find_substitute`, ...; writes are item H |
| **attendance** | Daily records | covered | `get_class_attendance`, `get_attendance_summary_school`, `get_unmarked_attendance`, `mark_attendance` |
| | OCR upload, accuracy, feedback | won't do | OCR is parked |
| | Anomalies | gap | read of alerts; face / anomaly features are class-only by decision (CLASS_SYSTEM_GUIDE 4, item 11) |
| **examinations** | Exam, exam subject, schedule | covered | `list_exams`, `create_exam`, `reschedule_exam`, `delete_exam` |
| | Marks | covered | `enter_marks`, `get_marks_entry_status`, `get_student_marks`, `get_exam_results`; delete one mark is item J |
| | Grade scale | covered | `get_grade_scale` |
| | Report card | **added** | `get_report_card` (the app builds it; Aura trims it) |
| | Exam papers, questions, worksheets | won't do | authoring tools with their own screens and heavy content |
| | Term assessment (conduct) | gap | read of skills / behaviour ratings; small |
| **finance** | Fees, payments, defaulters, balances | covered | 33 tools (`get_pending_fees`, `record_fee_payments`, ...) |
| | Discounts, scholarships | covered (assign) | `list_discounts`, `assign_student_discount`; create / edit definitions are item G |
| | Ledger, receipts | later | item G |
| | Online payments, Kuickpay | covered (status) | `get_online_payment_status`; gateway setup is not a chat job |
| | Sibling groups | gap | read; low value |
| **hr** | Staff, leave, attendance, payslips, salary | covered | 18 tools |
| | Departments, designations | **added** | `list_departments` |
| | Appraisals | gap | needs the owner's role rules (who may see a colleague's appraisal); admin-only if built |
| | Staff documents, qualifications | gap | admin-only read; low value |
| **inventory** | Items, stock, holders, low stock | covered | 7 tools |
| | Vendors | **added** | `list_vendors` |
| **library** | Books, issues, overdue | covered | 6 tools |
| **hostel** | Rooms, allocations, gate passes | covered | 5 tools |
| **transport** | Routes, vehicles, assignments | covered | 7 tools |
| | Live GPS, journeys | won't do | real-time map data does not suit chat |
| **lms** | Lesson plans, books, diary, assignments | covered | 8 tools |
| | Assignment submissions | later | item H |
| | Standards / objectives / content search (`semantic_search`) | gap | content search over books; large, needs its own plan |
| **parents** | Children, fees, results (parent's own) | covered | 12 `family` tools |
| | Parent leave requests (admin view) | **added** | `list_parent_leave_requests` |
| | Parent messages to the school | gap | admin read of threads; privacy review first |
| **notifications** | Messages to parents | covered | `send_message_to_parents`, `draft_message`, `list_recent_messages`, ... |
| | Templates, preferences, config | won't do | settings screens |
| **messaging** (staff threads) | Threads, messages | won't do | privacy: reading other people's conversations |
| **reports** | PDF / Excel, letters | won't do | file output does not fit chat; the Reports screen does it |
| **face_attendance** | Sessions, devices, embeddings | won't do | parked feature; biometric data |
| **brochure** | Careers, demo requests, contact | won't do | marketing-site delivery, not school data |

## Left as gaps (useful, not built here)

School calendar entries, last promotion run, attendance anomalies, term assessment ratings, appraisals (needs role rules), staff documents, parent messages (privacy review),
LMS content search. Say which to build next; each is a small read through the real view, with a cap and a test.

## How a new row stays honest

`assistant/tests/test_leakage.py` is generated from the registry, so every new tool above is already covered by the role matrix and the cross-tenant / cross-role checks.
`assistant/tests/test_coverage_reads.py` covers the six added reads.
