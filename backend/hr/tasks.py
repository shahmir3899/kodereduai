"""
Background tasks for HR operations.
"""

import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, time_limit=600)
def generate_payslips_task(self, school_id, user_id, month, year):
    """Bulk generate payslips for all active staff."""
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed

    task_id = self.request.id

    try:
        from decimal import Decimal
        from datetime import date
        from django.db.models import Q
        from django.contrib.auth import get_user_model
        from hr.models import StaffMember, SalaryStructure, Payslip

        User = get_user_model()
        user = User.objects.get(id=user_id)
        today = date.today()

        active_staff = list(StaffMember.objects.filter(
            school_id=school_id, is_active=True, employment_status='ACTIVE',
        ))
        total = len(active_staff)
        update_task_progress(task_id, current=0, total=total)

        created = 0
        skipped = 0

        for i, staff in enumerate(active_staff):
            if Payslip.objects.filter(
                school_id=school_id, staff_member=staff, month=month, year=year,
            ).exists():
                skipped += 1
                update_task_progress(task_id, current=i + 1)
                continue

            salary = SalaryStructure.objects.filter(
                school_id=school_id,
                staff_member=staff,
                is_active=True,
                effective_from__lte=today,
            ).filter(
                Q(effective_to__isnull=True) | Q(effective_to__gte=today)
            ).first()

            if not salary:
                skipped += 1
                update_task_progress(task_id, current=i + 1)
                continue

            Payslip.objects.create(
                school_id=school_id,
                staff_member=staff,
                month=month,
                year=year,
                basic_salary=salary.basic_salary,
                total_allowances=sum(Decimal(str(v)) for v in salary.allowances.values()),
                total_deductions=sum(Decimal(str(v)) for v in salary.deductions.values()),
                net_salary=salary.net_salary,
                allowances_breakdown=salary.allowances,
                deductions_breakdown=salary.deductions,
                status='DRAFT',
                generated_by=user,
            )
            created += 1
            update_task_progress(task_id, current=i + 1)

        result_data = {
            'created': created,
            'skipped': skipped,
            'message': f'{created} payslip(s) generated, {skipped} skipped.',
        }
        mark_task_success(task_id, result_data=result_data)
        return result_data

    except Exception as e:
        logger.exception(f"Payslip generation failed: {e}")
        mark_task_failed(task_id, str(e))
        raise
