"""
Background tasks for finance operations.
"""

import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, time_limit=600)
def generate_monthly_fees_task(self, school_id, month, year, class_id=None, academic_year_id=None):
    """Bulk generate fee payment records for a month/year."""
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed

    task_id = self.request.id

    try:
        from datetime import date
        from decimal import Decimal
        from django.db import transaction
        from django.db.models import Q
        from students.models import Student
        from finance.models import FeeStructure, FeePayment, MonthlyClosing

        # Block if period closed
        if MonthlyClosing.objects.filter(school_id=school_id, year=year, month=month).exists():
            mark_task_failed(task_id, f'Period {year}/{month:02d} is closed.')
            return {'error': f'Period {year}/{month:02d} is closed.'}

        # Fetch students (filtered by enrollment if academic year provided)
        student_qs = Student.objects.filter(school_id=school_id, is_active=True)
        if academic_year_id:
            student_qs = student_qs.filter(
                enrollments__academic_year_id=academic_year_id,
                enrollments__is_active=True,
            )
        if class_id:
            student_qs = student_qs.filter(class_obj_id=int(class_id))
        students = list(student_qs.distinct())

        total = len(students)
        update_task_progress(task_id, current=0, total=total)

        prev_month = month - 1
        prev_year = year
        if prev_month == 0:
            prev_month = 12
            prev_year = year - 1

        # Existing MONTHLY records for this month
        existing_ids = set(
            FeePayment.objects.filter(
                school_id=school_id, month=month, year=year, fee_type='MONTHLY'
            ).values_list('student_id', flat=True)
        )

        # MONTHLY fee structures only — build lookup in memory
        today = date.today()
        fee_structures = FeeStructure.objects.filter(
            school_id=school_id, is_active=True, effective_from__lte=today,
            fee_type='MONTHLY',
        ).filter(
            Q(effective_to__isnull=True) | Q(effective_to__gte=today)
        ).order_by('-effective_from')

        student_fees = {}
        class_fees = {}
        for fs in fee_structures:
            if fs.student_id:
                if fs.student_id not in student_fees:
                    student_fees[fs.student_id] = fs.monthly_amount
            elif fs.class_obj_id:
                if fs.class_obj_id not in class_fees:
                    class_fees[fs.class_obj_id] = fs.monthly_amount

        # Previous month balances for carry-forward (MONTHLY only)
        prev_balances = {}
        for fp in FeePayment.objects.filter(
            school_id=school_id, month=prev_month, year=prev_year, fee_type='MONTHLY'
        ):
            prev_balances[fp.student_id] = fp.amount_due - fp.amount_paid

        # Build payment objects
        created_count = 0
        skipped_count = 0
        no_fee_count = 0
        to_create = []

        for i, student in enumerate(students):
            if student.id in existing_ids:
                skipped_count += 1
            else:
                monthly_fee = student_fees.get(student.id)
                if monthly_fee is None:
                    monthly_fee = class_fees.get(student.class_obj_id)
                if monthly_fee is None:
                    no_fee_count += 1
                else:
                    prev_balance = prev_balances.get(student.id, Decimal('0'))
                    to_create.append(FeePayment(
                        school_id=school_id,
                        student=student,
                        fee_type='MONTHLY',
                        month=month,
                        year=year,
                        previous_balance=prev_balance,
                        amount_due=prev_balance + monthly_fee,
                        amount_paid=0,
                        academic_year_id=academic_year_id,
                    ))
                    created_count += 1

            if (i + 1) % 50 == 0 or i == total - 1:
                update_task_progress(task_id, current=i + 1)

        # Single bulk insert, atomic
        with transaction.atomic():
            FeePayment.objects.bulk_create(to_create)

        result_data = {
            'created': created_count,
            'skipped': skipped_count,
            'no_fee_structure': no_fee_count,
            'month': month,
            'year': year,
            'message': f'{created_count} fee record(s) generated, {skipped_count} skipped.',
        }
        mark_task_success(task_id, result_data=result_data)
        return result_data

    except Exception as e:
        logger.exception(f"Fee generation failed: {e}")
        mark_task_failed(task_id, str(e))
        raise


# =============================================================================
# Sibling Detection Tasks
# =============================================================================

@shared_task(bind=True, time_limit=300)
def detect_siblings_for_student_task(self, student_id):
    """Detect siblings for a single student (triggered by post_save signal)."""
    from students.models import Student
    from finance.sibling_detection import detect_siblings_for_student

    try:
        student = Student.objects.get(id=student_id, is_active=True)
    except Student.DoesNotExist:
        logger.warning(f"Sibling detection: Student {student_id} not found or inactive.")
        return {'student_id': student_id, 'suggestions_created': 0}

    count = detect_siblings_for_student(student)
    logger.info(f"Sibling detection for student {student_id}: {count} suggestion(s) created.")
    return {'student_id': student_id, 'suggestions_created': count}


@shared_task(bind=True, time_limit=1800)
def scan_all_siblings_task(self):
    """
    Nightly full scan: detect siblings across all active schools
    with the finance module enabled. Idempotent — skips pairs that
    already have pending/confirmed suggestions.
    """
    from schools.models import School
    from students.models import Student
    from finance.sibling_detection import detect_siblings_for_student

    schools = School.objects.filter(is_active=True)
    total_suggestions = 0

    for school in schools:
        enabled = school.enabled_modules if hasattr(school, 'enabled_modules') else {}
        if isinstance(enabled, dict) and not enabled.get('finance', False):
            continue

        students = Student.objects.filter(
            school=school, is_active=True,
        ).order_by('id')

        for student in students.iterator(chunk_size=100):
            count = detect_siblings_for_student(student)
            total_suggestions += count

    logger.info(f"Nightly sibling scan complete: {total_suggestions} new suggestion(s).")
    return {'total_suggestions': total_suggestions}
