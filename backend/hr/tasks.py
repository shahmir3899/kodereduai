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

        # 1 query: all active staff
        active_staff = list(StaffMember.objects.filter(
            school_id=school_id, is_active=True, employment_status='ACTIVE',
        ).select_related('department', 'designation'))
        total = len(active_staff)
        update_task_progress(task_id, current=0, total=total)

        # 1 query: existing payslip staff IDs for this month/year
        existing_staff_ids = set(Payslip.objects.filter(
            school_id=school_id, month=month, year=year,
        ).values_list('staff_member_id', flat=True))

        # 1 query: all active salary structures, build {staff_id: salary} map
        salary_qs = SalaryStructure.objects.filter(
            school_id=school_id,
            is_active=True,
            effective_from__lte=today,
        ).filter(
            Q(effective_to__isnull=True) | Q(effective_to__gte=today)
        ).order_by('staff_member_id', '-effective_from')

        salary_map = {}
        for sal in salary_qs:
            if sal.staff_member_id not in salary_map:
                salary_map[sal.staff_member_id] = sal

        # Build payslips to create
        to_create = []
        already_exists = 0
        no_salary = 0

        for i, staff in enumerate(active_staff):
            if staff.id in existing_staff_ids:
                already_exists += 1
            elif staff.id not in salary_map:
                no_salary += 1
            else:
                salary = salary_map[staff.id]
                to_create.append(Payslip(
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
                ))
            update_task_progress(task_id, current=i + 1)

        # 1 query: bulk insert
        if to_create:
            Payslip.objects.bulk_create(to_create, ignore_conflicts=True)
        created = len(to_create)

        parts = [f'{created} payslip(s) generated']
        if already_exists:
            parts.append(f'{already_exists} already existed')
        if no_salary:
            parts.append(f'{no_salary} have no salary structure')
        result_data = {
            'created': created,
            'already_exists': already_exists,
            'no_salary_structure': no_salary,
            'message': ', '.join(parts) + '.',
        }
        mark_task_success(task_id, result_data=result_data)
        return result_data

    except Exception as e:
        logger.exception(f"Payslip generation failed: {e}")
        mark_task_failed(task_id, str(e))
        raise
