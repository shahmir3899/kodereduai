"""
Background tasks for finance operations.
"""

import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, time_limit=600)
def generate_monthly_fees_task(self, school_id, month, year, class_id=None):
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

        # Fetch students
        students = list(Student.objects.filter(school_id=school_id, is_active=True))
        if class_id:
            students = [s for s in students if s.class_obj_id == int(class_id)]

        total = len(students)
        update_task_progress(task_id, current=0, total=total)

        prev_month = month - 1
        prev_year = year
        if prev_month == 0:
            prev_month = 12
            prev_year = year - 1

        # Existing records for this month
        existing_ids = set(
            FeePayment.objects.filter(
                school_id=school_id, month=month, year=year
            ).values_list('student_id', flat=True)
        )

        # Fee structures — build lookup in memory
        today = date.today()
        fee_structures = FeeStructure.objects.filter(
            school_id=school_id, is_active=True, effective_from__lte=today,
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

        # Previous month balances for carry-forward
        prev_balances = {}
        for fp in FeePayment.objects.filter(
            school_id=school_id, month=prev_month, year=prev_year
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
                        month=month,
                        year=year,
                        previous_balance=prev_balance,
                        amount_due=prev_balance + monthly_fee,
                        amount_paid=0,
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
