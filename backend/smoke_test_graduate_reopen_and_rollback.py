#!/usr/bin/env python
"""
Real smoke test for graduated-row correction support.

Flow:
1) Pick one graduated source enrollment (school 2, 2025-26 -> 2026-27) with no target enrollment.
2) Apply real correction: REPEAT (creates target enrollment).
3) Verify changed state.
4) Apply real correction: GRADUATE (removes target enrollment, restores terminal state).
5) Verify restored state.
"""

import os
import sys

import django

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.db import transaction

from academic_sessions.models import AcademicYear, PromotionOperation, StudentEnrollment
from academic_sessions.views import StudentEnrollmentViewSet
from users.models import User


def main():
    school_id = 2
    source_year = AcademicYear.objects.get(id=10)
    target_year = AcademicYear.objects.get(id=43)

    # Pick one graduated student without target enrollment.
    source_enrollment = (
        StudentEnrollment.objects
        .filter(
            school_id=school_id,
            academic_year_id=source_year.id,
            status=StudentEnrollment.Status.GRADUATED,
            is_active=True,
        )
        .select_related("student", "class_obj")
        .order_by("id")
        .first()
    )
    if not source_enrollment:
        print("No graduated source enrollment found for smoke test.")
        return

    student_id = source_enrollment.student_id
    original_roll = source_enrollment.roll_number
    original_source_status = source_enrollment.status
    original_student_status = source_enrollment.student.status
    original_student_class = source_enrollment.student.class_obj_id

    target_exists_before = StudentEnrollment.objects.filter(
        school_id=school_id,
        student_id=student_id,
        academic_year_id=target_year.id,
    ).exists()

    if target_exists_before:
        print("Chosen student already has target enrollment; cannot run this smoke scenario safely.")
        return

    acting_user = (
        User.objects.filter(school_id=school_id, is_active=True)
        .order_by("id")
        .first()
    )

    print("--- SMOKE TEST START ---")
    print(f"student_id={student_id}")
    print(f"student_name={source_enrollment.student.name}")
    print(f"source_status_before={original_source_status}")
    print(f"student_status_before={original_student_status}")
    print(f"target_exists_before={target_exists_before}")

    view = StudentEnrollmentViewSet()

    # Step 1: real correction to REPEAT.
    op1 = PromotionOperation.objects.create(
        school_id=school_id,
        source_academic_year=source_year,
        target_academic_year=target_year,
        operation_type=PromotionOperation.OperationType.SINGLE_CORRECTION,
        total_students=1,
        reason="Smoke test: graduated -> repeat",
        initiated_by=acting_user,
        metadata={"source": "smoke_test_graduate_reopen_and_rollback", "step": 1},
    )

    with transaction.atomic():
        result1 = view._run_single_correction(
            school_id=school_id,
            source_year=source_year,
            target_year=target_year,
            correction={
                "student_id": student_id,
                "action": "REPEAT",
                "target_class_id": source_enrollment.class_obj_id,
                "new_roll_number": original_roll,
                "reason": "Smoke test: reopen graduated to repeat",
            },
            operation=op1,
            request_user=acting_user,
            dry_run=False,
        )

    view._update_operation_status(
        op1,
        processed_count=(1 if result1.get("ok") else 0),
        skipped_count=(0 if result1.get("ok") else 1),
        error_count=0,
    )

    src_after_step1 = StudentEnrollment.objects.get(id=source_enrollment.id)
    tgt_after_step1 = StudentEnrollment.objects.filter(
        school_id=school_id,
        student_id=student_id,
        academic_year_id=target_year.id,
    ).first()
    student_after_step1 = src_after_step1.student

    print("\n--- AFTER STEP 1 (REPEAT) ---")
    print("result1=", result1)
    print(f"source_status={src_after_step1.status}")
    print(f"target_exists={bool(tgt_after_step1)}")
    print(f"student_status={student_after_step1.status}")
    print(f"student_class={student_after_step1.class_obj_id}")

    if not result1.get("ok") or not tgt_after_step1:
        print("Step 1 failed. Aborting rollback step.")
        return

    # Step 2: real correction back to GRADUATE (rollback).
    op2 = PromotionOperation.objects.create(
        school_id=school_id,
        source_academic_year=source_year,
        target_academic_year=target_year,
        operation_type=PromotionOperation.OperationType.SINGLE_CORRECTION,
        total_students=1,
        reason="Smoke test rollback: repeat -> graduate",
        initiated_by=acting_user,
        metadata={"source": "smoke_test_graduate_reopen_and_rollback", "step": 2},
    )

    with transaction.atomic():
        result2 = view._run_single_correction(
            school_id=school_id,
            source_year=source_year,
            target_year=target_year,
            correction={
                "student_id": student_id,
                "action": "GRADUATE",
                "reason": "Smoke test rollback to original graduate state",
            },
            operation=op2,
            request_user=acting_user,
            dry_run=False,
        )

    view._update_operation_status(
        op2,
        processed_count=(1 if result2.get("ok") else 0),
        skipped_count=(0 if result2.get("ok") else 1),
        error_count=0,
    )

    src_after_step2 = StudentEnrollment.objects.get(id=source_enrollment.id)
    tgt_after_step2_exists = StudentEnrollment.objects.filter(
        school_id=school_id,
        student_id=student_id,
        academic_year_id=target_year.id,
    ).exists()
    student_after_step2 = src_after_step2.student

    print("\n--- AFTER STEP 2 (ROLLBACK TO GRADUATE) ---")
    print("result2=", result2)
    print(f"source_status={src_after_step2.status}")
    print(f"target_exists={tgt_after_step2_exists}")
    print(f"student_status={student_after_step2.status}")
    print(f"student_class={student_after_step2.class_obj_id}")

    restored = (
        src_after_step2.status == original_source_status
        and not tgt_after_step2_exists
        and student_after_step2.status == original_student_status
        and student_after_step2.class_obj_id == original_student_class
    )

    print("\n--- FINAL ---")
    print(f"restored_to_original={restored}")
    print(f"operation_ids=({op1.id}, {op2.id})")


if __name__ == "__main__":
    main()
