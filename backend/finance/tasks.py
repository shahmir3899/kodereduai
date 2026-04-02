"""
Background tasks for finance operations.
"""

import logging
from celery import shared_task

from .generation_planner import plan_scope_records

logger = logging.getLogger(__name__)


@shared_task(bind=True, time_limit=600)
def generate_monthly_fees_task(
    self, school_id, month, year, class_id=None, academic_year_id=None,
    monthly_category_ids=None,
):
    """Bulk generate fee payment records for a month/year, per monthly category."""
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed

    task_id = self.request.id

    try:
        from datetime import date
        from decimal import Decimal
        from django.db import transaction
        from students.models import Student
        from finance.models import FeePayment, MonthlyClosing, MonthlyFeeCategory

        # Block if period closed
        if MonthlyClosing.objects.filter(school_id=school_id, year=year, month=month).exists():
            mark_task_failed(task_id, f'Period {year}/{month:02d} is closed.')
            return {'error': f'Period {year}/{month:02d} is closed.'}

        # Resolve which categories to generate for
        if monthly_category_ids:
            categories = list(MonthlyFeeCategory.objects.filter(
                id__in=monthly_category_ids, school_id=school_id, is_active=True,
            ))
        else:
            categories = list(MonthlyFeeCategory.objects.filter(
                school_id=school_id, is_active=True,
            ))

        if not categories:
            result_data = {
                'created': 0, 'skipped': 0, 'no_fee_structure': 0,
                'month': month, 'year': year,
                'message': 'No active monthly fee categories found.',
            }
            mark_task_success(task_id, result_data=result_data)
            return result_data

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

        total = len(students) * len(categories)
        update_task_progress(task_id, current=0, total=total)

        prev_month = month - 1
        prev_year = year
        if prev_month == 0:
            prev_month = 12
            prev_year = year - 1

        created_count = 0
        skipped_count = 0
        no_fee_count = 0
        progress = 0

        with transaction.atomic():
            for category in categories:
                cat_id = category.id

                # Records that already exist for this month+category
                existing_ids = set(
                    FeePayment.objects.filter(
                        school_id=school_id, month=month, year=year,
                        fee_type='MONTHLY', monthly_category_id=cat_id,
                    ).values_list('student_id', flat=True)
                )

                plan = plan_scope_records(
                    school_id=school_id,
                    students=students,
                    fee_type='MONTHLY',
                    existing_ids=existing_ids,
                    monthly_category_id=cat_id,
                )
                skipped_count += plan['already_exist']
                no_fee_count += plan['no_fee_structure']

                # Per-category carry-forward from previous month
                prev_balances = {}
                for fp in FeePayment.objects.filter(
                    school_id=school_id, month=prev_month, year=prev_year,
                    fee_type='MONTHLY', monthly_category_id=cat_id,
                ):
                    prev_balances[fp.student_id] = fp.amount_due - fp.amount_paid

                to_create = []
                for entry in plan['creatable']:
                    student = entry['student']
                    monthly_fee = entry['amount']
                    prev_balance = prev_balances.get(student.id, Decimal('0'))
                    to_create.append(FeePayment(
                        school_id=school_id,
                        student=student,
                        fee_type='MONTHLY',
                        monthly_category_id=cat_id,
                        month=month,
                        year=year,
                        previous_balance=prev_balance,
                        base_monthly_fee=monthly_fee,
                        amount_due=prev_balance + monthly_fee,
                        amount_paid=0,
                        academic_year_id=academic_year_id,
                    ))
                    created_count += 1

                for _ in students:
                    progress += 1
                    if progress % 50 == 0 or progress == total:
                        update_task_progress(task_id, current=progress)

                if to_create:
                    FeePayment.objects.bulk_create(to_create, batch_size=1000)

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


@shared_task(bind=True, time_limit=900)
def generate_annual_fees_task(
    self, school_id, year, annual_category_ids, class_id=None, academic_year_id=None,
):
    """Bulk-generate annual fee records for selected categories."""
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed

    task_id = self.request.id

    try:
        from django.db import transaction
        from students.models import Student
        from finance.models import AnnualFeeCategory, FeePayment

        categories = list(AnnualFeeCategory.objects.filter(
            id__in=annual_category_ids,
            school_id=school_id,
            is_active=True,
        ))
        if not categories:
            result_data = {
                'created': 0,
                'skipped': 0,
                'no_fee_structure': 0,
                'year': year,
                'message': 'No valid annual categories found.',
            }
            mark_task_success(task_id, result_data=result_data)
            return result_data

        student_qs = Student.objects.filter(school_id=school_id, is_active=True)
        if academic_year_id:
            student_qs = student_qs.filter(
                enrollments__academic_year_id=academic_year_id,
                enrollments__is_active=True,
            )
        if class_id:
            student_qs = student_qs.filter(class_obj_id=class_id)
        students = list(student_qs.distinct())

        total = len(students) * len(categories)
        update_task_progress(task_id, current=0, total=total)

        created_count = 0
        skipped_count = 0
        no_fee_count = 0
        progress = 0

        with transaction.atomic():
            for category in categories:
                existing_ids = set(
                    FeePayment.objects.filter(
                        school_id=school_id,
                        month=0,
                        year=year,
                        fee_type='ANNUAL',
                        annual_category_id=category.id,
                    ).values_list('student_id', flat=True)
                )

                plan = plan_scope_records(
                    school_id=school_id,
                    students=students,
                    fee_type='ANNUAL',
                    existing_ids=existing_ids,
                    annual_category_id=category.id,
                )
                skipped_count += plan['already_exist']
                no_fee_count += plan['no_fee_structure']

                to_create = []
                for entry in plan['creatable']:
                    student = entry['student']
                    amount = entry['amount']
                    to_create.append(FeePayment(
                        school_id=school_id,
                        student=student,
                        fee_type='ANNUAL',
                        annual_category_id=category.id,
                        month=0,
                        year=year,
                        amount_due=amount,
                        amount_paid=0,
                        academic_year_id=academic_year_id,
                    ))
                    created_count += 1

                for _ in students:
                    progress += 1
                    if progress % 50 == 0 or progress == total:
                        update_task_progress(task_id, current=progress)

                if to_create:
                    FeePayment.objects.bulk_create(to_create, batch_size=1000)

        result_data = {
            'created': created_count,
            'skipped': skipped_count,
            'no_fee_structure': no_fee_count,
            'year': year,
            'message': f'{created_count} annual fee record(s) generated, {skipped_count} skipped.',
        }
        mark_task_success(task_id, result_data=result_data)
        return result_data

    except Exception as e:
        logger.exception(f"Annual fee generation failed: {e}")
        mark_task_failed(task_id, str(e))
        raise


@shared_task(bind=True, time_limit=900)
def generate_onetime_fees_task(
    self,
    school_id,
    fee_types,
    year,
    month_for_monthly=0,
    class_id=None,
    student_ids=None,
    academic_year_id=None,
):
    """Bulk-generate one-time fee records (admission/books/fine/monthly fallback)."""
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed

    task_id = self.request.id

    try:
        from datetime import date
        from django.db import transaction
        from students.models import Student
        from finance.models import FeePayment

        student_qs = Student.objects.filter(school_id=school_id, is_active=True)
        if student_ids:
            student_qs = student_qs.filter(id__in=student_ids)
        elif class_id:
            student_qs = student_qs.filter(class_obj_id=class_id)
        if academic_year_id:
            student_qs = student_qs.filter(
                enrollments__academic_year_id=academic_year_id,
                enrollments__is_active=True,
            )
        students = list(student_qs.distinct())

        total = len(students) * len(fee_types)
        update_task_progress(task_id, current=0, total=total)

        created_count = 0
        skipped_count = 0
        no_fee_count = 0
        progress = 0
        today_month = date.today().month

        to_create = []
        with transaction.atomic():
            for fee_type in fee_types:
                month = month_for_monthly if (fee_type == 'MONTHLY' and month_for_monthly >= 1) else (today_month if fee_type == 'MONTHLY' else 0)

                existing_ids = set(
                    FeePayment.objects.filter(
                        school_id=school_id,
                        month=month,
                        year=year,
                        fee_type=fee_type,
                    ).values_list('student_id', flat=True)
                )

                plan = plan_scope_records(
                    school_id=school_id,
                    students=students,
                    fee_type=fee_type,
                    existing_ids=existing_ids,
                )
                skipped_count += plan['already_exist']
                no_fee_count += plan['no_fee_structure']

                for entry in plan['creatable']:
                    student = entry['student']
                    amount = entry['amount']
                    to_create.append(FeePayment(
                        school_id=school_id,
                        student=student,
                        fee_type=fee_type,
                        month=month,
                        year=year,
                        amount_due=amount,
                        amount_paid=0,
                        academic_year_id=academic_year_id,
                        base_monthly_fee=amount if fee_type == 'MONTHLY' else None,
                    ))
                    created_count += 1

                progress += len(students)
                if progress % 50 == 0 or progress == total:
                    update_task_progress(task_id, current=progress)

            if to_create:
                FeePayment.objects.bulk_create(to_create, batch_size=1000)

        result_data = {
            'created': created_count,
            'skipped': skipped_count,
            'no_fee_structure': no_fee_count,
            'year': year,
            'message': f'{created_count} fee record(s) generated, {skipped_count} skipped.',
        }
        mark_task_success(task_id, result_data=result_data)
        return result_data

    except Exception as e:
        logger.exception(f"One-time fee generation failed: {e}")
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
