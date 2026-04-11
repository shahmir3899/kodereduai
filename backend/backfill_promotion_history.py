#!/usr/bin/env python
"""
Backfill PromotionOperation + PromotionEvent from existing enrollments.

Safety:
- Idempotent at event level for a transition (student_id + event_type check).
- Runs in a single transaction.
- Supports dry-run mode by default; use --commit to write.

Business rule:
- Graduated source enrollments are terminal and do NOT require target enrollment.
"""

import argparse
import os
import sys
from collections import Counter

import django
from django.db import transaction

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from academic_sessions.models import (  # noqa: E402
    AcademicYear,
    PromotionEvent,
    PromotionOperation,
    StudentEnrollment,
)
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


def infer_event(source_enr, target_enr):
    src_status = source_enr.status

    if src_status == StudentEnrollment.Status.GRADUATED:
        return (PromotionEvent.EventType.GRADUATED, True, "graduated_terminal_exempt")

    if src_status in (StudentEnrollment.Status.TRANSFERRED, StudentEnrollment.Status.WITHDRAWN):
        return (None, False, f"terminal_{src_status.lower()}_skip")

    if target_enr is None:
        return (None, False, "missing_target_enrollment")

    if src_status == StudentEnrollment.Status.REPEAT:
        return (PromotionEvent.EventType.REPEATED, True, "source_status_repeat")

    if source_enr.class_obj_id == target_enr.class_obj_id:
        return (PromotionEvent.EventType.REPEATED, True, "same_class_repeat")

    return (PromotionEvent.EventType.PROMOTED, True, "class_changed_promote")


def build_event_payload(source_enr, target_enr, event_type, source_year, target_year, created_by_id=None):
    if event_type == PromotionEvent.EventType.GRADUATED:
        old_status = StudentEnrollment.Status.ACTIVE
        new_status = StudentEnrollment.Status.GRADUATED
        old_roll = source_enr.roll_number
        new_roll = source_enr.roll_number
    elif event_type == PromotionEvent.EventType.REPEATED:
        old_status = StudentEnrollment.Status.ACTIVE
        new_status = StudentEnrollment.Status.REPEAT
        old_roll = source_enr.roll_number
        new_roll = target_enr.roll_number if target_enr else source_enr.roll_number
    else:  # PROMOTED
        old_status = StudentEnrollment.Status.ACTIVE
        new_status = StudentEnrollment.Status.PROMOTED
        old_roll = source_enr.roll_number
        new_roll = target_enr.roll_number if target_enr else source_enr.roll_number

    return {
        "school_id": source_enr.school_id,
        "student_id": source_enr.student_id,
        "source_enrollment_id": source_enr.id,
        "target_enrollment_id": target_enr.id if target_enr else None,
        "source_academic_year_id": source_year.id,
        "target_academic_year_id": target_year.id,
        "source_class_id": source_enr.class_obj_id,
        "target_class_id": target_enr.class_obj_id if target_enr else None,
        "source_session_class_id": source_enr.session_class_id,
        "target_session_class_id": target_enr.session_class_id if target_enr else None,
        "event_type": event_type,
        "old_status": old_status,
        "new_status": new_status,
        "old_roll_number": old_roll or "",
        "new_roll_number": new_roll or "",
        "reason": "Backfilled from enrollment transition.",
        "details": {
            "source": "backfill_script",
            "source_enrollment_status": source_enr.status,
            "target_present": bool(target_enr),
        },
        "created_by_id": created_by_id,
    }


def main():
    parser = argparse.ArgumentParser(description="Backfill promotion history from enrollments")
    parser.add_argument("--school-id", type=int, default=2)
    parser.add_argument("--source-year-id", type=int, default=None)
    parser.add_argument("--target-year-id", type=int, default=None)
    parser.add_argument("--source-name-hint", default="2025-26")
    parser.add_argument("--target-name-hint", default="2026-27")
    parser.add_argument("--initiated-by", type=int, default=None, help="User ID for operation.initiated_by / event.created_by")
    parser.add_argument("--commit", action="store_true", help="Actually write records")
    args = parser.parse_args()

    school = School.objects.filter(id=args.school_id).first()
    if not school:
        print(f"School not found: id={args.school_id}")
        sys.exit(1)

    source_year = resolve_year(args.school_id, args.source_year_id, args.source_name_hint)
    target_year = resolve_year(args.school_id, args.target_year_id, args.target_name_hint)
    if not source_year or not target_year:
        print("Could not resolve source/target year")
        sys.exit(1)

    source_enrollments = list(
        StudentEnrollment.objects.filter(
            school_id=school.id,
            academic_year_id=source_year.id,
            is_active=True,
        ).select_related("student", "class_obj", "session_class")
    )
    target_enrollments = list(
        StudentEnrollment.objects.filter(
            school_id=school.id,
            academic_year_id=target_year.id,
            is_active=True,
        ).select_related("class_obj", "session_class")
    )
    target_by_student = {e.student_id: e for e in target_enrollments}

    existing_events = PromotionEvent.objects.filter(
        school_id=school.id,
        source_academic_year_id=source_year.id,
        target_academic_year_id=target_year.id,
    )
    existing_keys = set(existing_events.values_list("student_id", "event_type"))

    counters = Counter()
    payloads = []

    for src in source_enrollments:
        tgt = target_by_student.get(src.student_id)
        event_type, eligible, reason = infer_event(src, tgt)
        counters[f"reason_{reason}"] += 1

        if not eligible or not event_type:
            counters["skip"] += 1
            continue

        if (src.student_id, event_type) in existing_keys:
            counters["already_exists"] += 1
            continue

        payloads.append(build_event_payload(src, tgt, event_type, source_year, target_year, args.initiated_by))
        counters[f"event_{event_type}"] += 1

    print(SEP)
    print("BACKFILL PREVIEW")
    print(SEP)
    print(f"School: {school.name} (ID={school.id})")
    print(f"Source: {source_year.name} (ID={source_year.id})")
    print(f"Target: {target_year.name} (ID={target_year.id})")
    print(f"Source active enrollments: {len(source_enrollments)}")
    print(f"Target active enrollments: {len(target_enrollments)}")
    print(f"Existing transition events: {existing_events.count()}")
    print(f"Would insert events: {len(payloads)}")
    print(f"PROMOTED: {counters['event_PROMOTED']}")
    print(f"REPEATED: {counters['event_REPEATED']}")
    print(f"GRADUATED: {counters['event_GRADUATED']}")
    print(f"Skipped ineligible: {counters['skip']}")
    print(f"Already existed: {counters['already_exists']}")

    if not args.commit:
        print("\nDRY MODE ONLY (no DB writes). Re-run with --commit to apply.")
        return

    with transaction.atomic():
        op = PromotionOperation.objects.create(
            school_id=school.id,
            source_academic_year_id=source_year.id,
            target_academic_year_id=target_year.id,
            operation_type=PromotionOperation.OperationType.BULK_PROMOTE,
            status=PromotionOperation.OperationStatus.SUCCESS,
            total_students=len(source_enrollments),
            processed_count=len(payloads),
            skipped_count=counters["skip"] + counters["already_exists"],
            error_count=0,
            reason="Synthetic backfill from existing enrollment transitions.",
            initiated_by_id=args.initiated_by,
            metadata={
                "source": "backfill_script",
                "mode": "commit",
                "graduated_terminal_exempt": True,
            },
        )

        event_objs = [PromotionEvent(operation=op, **p) for p in payloads]
        PromotionEvent.objects.bulk_create(event_objs, batch_size=500)

    print("\nCOMMIT COMPLETE")
    print(f"Created PromotionOperation ID: {op.id}")
    print(f"Inserted PromotionEvent rows: {len(payloads)}")
    print(SEP)


if __name__ == "__main__":
    main()
