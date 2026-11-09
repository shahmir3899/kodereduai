# Item A: class-system audit of Aura's tools

Rule (CLASS_SYSTEM_GUIDE.md): never hand-roll a class resolver; decide per feature whether it is per master class or per section; handle `invalid` (orphan) sections.
Spoken names ("5A", "Class 5") are matched by `directory.class_key` (the one normaliser). Validity of a matched section goes through
`core.class_scope.validate_session_scope` (request-free core of `resolve_class_scope`, same rules as the views).

| Tool group | Scope | Resolver | Status |
|---|---|---|---|
| Lesson plans, books, diary, assignments (`lms_reads`, `lms_writes`) | per section | `find_sections` | OK; orphan sections now refused with a message |
| Attendance (`attendance_tools`) | per section | `find_sections` | OK (same) |
| Students: list, class change, enquiry conversion (`student_tools`) | per section | `find_sections` | OK (same) |
| Messaging to a class (`messaging_tools`) | whole class or one section | `find_sections` | OK (same) |
| Exams (`exam_tools`) | `Exam.session_class` now exists (null = every section) | `find_sections` | OK; guide section 3 is stale on this point |
| `find_student` | this year's section | enrolment, falls back to `Student.class_obj` | FIXED (was the snapshot only) |
| `find_class` | current-year sections + master `class_id` | `class_key` | FIXED (was master classes only) |
| `add_enquiry` | master class (grade) | `find_class` | adjusted for the new `find_class` result |
| Academics reads (schedule, class info, quality, gaps, conflict) | master class (timetable is master-only by design) | `master_classes_matching` | FIXED (was `name__icontains`; "Class 1" matched Class 10, "4A" never matched) |
| Fee structure read | master class (decided 2026-09-25) | `master_classes_matching` | FIXED (same) |
| Pending / unpaid fee reads and fee-payment proposals | per section (payment's own year) | `_payment_class_q(name, school_id)` | FIXED (substring match; "2A" now means only that section) |

Not changed: timetable stays per master class (Fix List item 9 in the guide needs a schema decision), no schema changes made.
