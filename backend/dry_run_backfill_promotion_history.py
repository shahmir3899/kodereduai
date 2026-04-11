#!/usr/bin/env python
"""
Dry-run backfill planner for PromotionOperation/PromotionEvent.

This script DOES NOT write to the database.
It previews which promotion history rows would be inserted.

Rules:
- Graduated students are terminal and do not require target-year enrollment.
- Non-graduated students generally require target-year enrollment to be backfillable.
"""

import argparse
import os
import sys
from collections import Counter

import django

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from academic_sessions.models import AcademicYear, PromotionEvent, StudentEnrollment  # noqa: E402
from schools.models import School  # noqa: E402


SEP = "=" * 90


def resolve_year(school_id, year_id=None, name_hint=None):
    qs = AcademicYear.objects.filter(school_id=school_id)
    if year_id:
        return qs.filter(id=year_id).first()
    if name_hint:
        hint = name_hint.strip().lower()
        for y in qs:
            if hint in (y.name or "").lower():
                return y
    return None


def short_class(enr):
    if not enr:
        return "-"
    return enr.class_obj.name if enr.class_obj_id else "-"


def infer_event(source_enr, target_enr):
    """
    Returns tuple:
      (inferred_event_type, would_insert, correction_ready, reason_code)
    """
    src_status = source_enr.status

    # Explicit terminal rule requested by user: graduated does not need target enrollment.
    if src_status == StudentEnrollment.Status.GRADUATED:
        return (PromotionEvent.EventType.GRADUATED, True, False, "graduated_terminal_exempt")

    # Transfer/withdrawn are terminal but not promotion actions in this flow.
    if src_status in (StudentEnrollment.Status.TRANSFERRED, StudentEnrollment.Status.WITHDRAWN):
        return (None, False, False, f"terminal_{src_status.lower()}_skip")

    if target_enr is None:
        return (None, False, False, "missing_target_enrollment")

    # For non-terminal records, classify with target comparison.
    if src_status == StudentEnrollment.Status.REPEAT:
        return (PromotionEvent.EventType.REPEATED, True, True, "source_status_repeat")

    if source_enr.class_obj_id == target_enr.class_obj_id:
        return (PromotionEvent.EventType.REPEATED, True, True, "same_class_repeat")

    # Default non-terminal with target enrollment -> promoted.
    return (PromotionEvent.EventType.PROMOTED, True, True, "class_changed_promote")


def main():
    parser = argparse.ArgumentParser(description="Dry-run planner for promotion history backfill")
    parser.add_argument("--school-id", type=int, default=2, help="School ID (default: 2)")
    parser.add_argument("--source-year-id", type=int, default=None, help="Source academic year ID")
    parser.add_argument("--target-year-id", type=int, default=None, help="Target academic year ID")
    parser.add_argument("--source-name-hint", default="2025-26", help="Source year name hint if ID not provided")
    parser.add_argument("--target-name-hint", default="2026-27", help="Target year name hint if ID not provided")
    parser.add_argument("--limit", type=int, default=80, help="How many detailed rows to print")
    args = parser.parse_args()

    school = School.objects.filter(id=args.school_id).first()
    if not school:
        print(f"School not found: id={args.school_id}")
        sys.exit(1)

    source_year = resolve_year(args.school_id, args.source_year_id, args.source_name_hint)
    target_year = resolve_year(args.school_id, args.target_year_id, args.target_name_hint)
    if not source_year or not target_year:
        print("Unable to resolve source/target academic years.")
        print(f"source_year={getattr(source_year, 'id', None)} target_year={getattr(target_year, 'id', None)}")
        sys.exit(1)

    print(SEP)
    print("PROMOTION HISTORY BACKFILL DRY RUN")
    print(SEP)
    print(f"School: {school.name} (ID={school.id})")
    print(f"Source Year: {source_year.name} (ID={source_year.id})")
    print(f"Target Year: {target_year.name} (ID={target_year.id})")

    source_enrollments = list(
        StudentEnrollment.objects.filter(
            school_id=school.id,
            academic_year_id=source_year.id,
            is_active=True,
        )
        .select_related("student", "class_obj", "session_class")
        .order_by("class_obj__grade_level", "class_obj__name", "roll_number", "id")
    )

    target_enrollments = list(
        StudentEnrollment.objects.filter(
            school_id=school.id,
            academic_year_id=target_year.id,
            is_active=True,
        )
        .select_related("class_obj", "session_class")
    )
    target_by_student = {e.student_id: e for e in target_enrollments}

    existing_events = PromotionEvent.objects.filter(
        school_id=school.id,
        source_academic_year_id=source_year.id,
        target_academic_year_id=target_year.id,
    )

    existing_keys = set(existing_events.values_list("student_id", "event_type"))

    print(f"Source active enrollments: {len(source_enrollments)}")
    print(f"Target active enrollments: {len(target_enrollments)}")
    print(f"Existing PromotionEvent rows for transition: {existing_events.count()}")
    print()

    preview_rows = []
    counters = Counter()

    for src in source_enrollments:
        tgt = target_by_student.get(src.student_id)
        inferred_event, would_insert, correction_ready, reason_code = infer_event(src, tgt)

        if inferred_event and (src.student_id, inferred_event) in existing_keys:
            would_insert = False
            reason_code = "already_has_event"

        if inferred_event:
            counters[f"event_{inferred_event}"] += 1
        else:
            counters["event_NONE"] += 1

        counters[f"reason_{reason_code}"] += 1
        counters["would_insert_yes" if would_insert else "would_insert_no"] += 1
        counters["correction_ready_yes" if correction_ready else "correction_ready_no"] += 1

        preview_rows.append(
            {
                "student_id": src.student_id,
                "student_name": src.student.name if src.student_id else "-",
                "source_enrollment_id": src.id,
                "target_enrollment_id": tgt.id if tgt else None,
                "source_class": short_class(src),
                "target_class": short_class(tgt),
                "source_status": src.status,
                "inferred_event": inferred_event or "SKIP",
                "would_insert": would_insert,
                "correction_ready": correction_ready,
                "reason_code": reason_code,
            }
        )

    # Synthetic operation preview summary
    print(SEP)
    print("SYNTHETIC OPERATION PREVIEW")
    print(SEP)
    print("operation_type: BULK_PROMOTE (synthetic history backfill)")
    print(f"total_students: {len(source_enrollments)}")
    print(f"would_insert_events: {counters['would_insert_yes']}")
    print(f"would_skip_events: {counters['would_insert_no']}")
    print(f"PROMOTED: {counters['event_PROMOTED']}")
    print(f"REPEATED: {counters['event_REPEATED']}")
    print(f"GRADUATED: {counters['event_GRADUATED']}")
    print(f"SKIP/UNKNOWN: {counters['event_NONE']}")
    print(f"correction_ready_yes: {counters['correction_ready_yes']}")
    print(f"correction_ready_no: {counters['correction_ready_no']}")

    print()
    print(SEP)
    print("REASON BREAKDOWN")
    print(SEP)
    reason_keys = sorted(k for k in counters.keys() if k.startswith("reason_"))
    for k in reason_keys:
        print(f"{k.replace('reason_', '')}: {counters[k]}")

    print()
    print(SEP)
    print("DETAIL PREVIEW")
    print(SEP)
    print(
        f"{'student_id':<11} {'name':<28} {'src_cls':<12} {'tgt_cls':<12} "
        f"{'src_status':<11} {'event':<10} {'insert':<7} {'correct':<8} reason"
    )
    print("-" * 90)

    for row in preview_rows[: args.limit]:
        print(
            f"{row['student_id']:<11} "
            f"{row['student_name'][:27]:<28} "
            f"{row['source_class'][:11]:<12} "
            f"{row['target_class'][:11]:<12} "
            f"{row['source_status']:<11} "
            f"{row['inferred_event']:<10} "
            f"{str(row['would_insert']):<7} "
            f"{str(row['correction_ready']):<8} "
            f"{row['reason_code']}"
        )

    if len(preview_rows) > args.limit:
        print(f"... ({len(preview_rows) - args.limit} more rows not shown; increase --limit)")

    print()
    print(SEP)
    print("NO DATABASE WRITES PERFORMED")
    print(SEP)


if __name__ == "__main__":
    main()
