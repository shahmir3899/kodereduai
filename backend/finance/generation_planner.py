"""Shared planner for fee-generation previews.

This module batches fee structure and existing-payment lookups so preview
endpoints avoid per-student database calls.
"""

from datetime import date
from decimal import Decimal

from django.db.models import Q

from .models import AnnualFeeCategory, FeePayment, FeeStructure, MonthlyFeeCategory


def _active_fee_structures(school_id, fee_type, today, annual_category_id=None, monthly_category_id=None):
    """Return active fee structures ordered newest-first for precedence rules."""
    filters = {
        'school_id': school_id,
        'fee_type': fee_type,
        'is_active': True,
        'effective_from__lte': today,
    }
    if annual_category_id is not None:
        filters['annual_category_id'] = annual_category_id
    if monthly_category_id is not None:
        filters['monthly_category_id'] = monthly_category_id

    return FeeStructure.objects.filter(**filters).filter(
        Q(effective_to__isnull=True) | Q(effective_to__gte=today)
    ).order_by('-effective_from')


def _build_fee_maps(school_id, fee_type, today, annual_category_id=None, monthly_category_id=None):
    """Build student and class fee maps from active structures."""
    student_fees = {}
    class_fees = {}

    # Primary map for requested scope/category.
    primary_structures = _active_fee_structures(
        school_id,
        fee_type,
        today,
        annual_category_id=annual_category_id,
        monthly_category_id=monthly_category_id,
    )
    for fs in primary_structures:
        if fs.student_id and fs.student_id not in student_fees:
            student_fees[fs.student_id] = fs.monthly_amount
        elif fs.class_obj_id and fs.class_obj_id not in class_fees:
            class_fees[fs.class_obj_id] = fs.monthly_amount

    # Backward-compat fallback:
    # older MONTHLY overrides may have monthly_category=NULL (global monthly override).
    # Use these only when category-specific value is not available.
    if fee_type == 'MONTHLY' and monthly_category_id is not None:
        fallback_structures = _active_fee_structures(
            school_id,
            fee_type,
            today,
            monthly_category_id=None,
        ).filter(monthly_category__isnull=True)
        for fs in fallback_structures:
            if fs.student_id and fs.student_id not in student_fees:
                student_fees[fs.student_id] = fs.monthly_amount
            elif fs.class_obj_id and fs.class_obj_id not in class_fees:
                class_fees[fs.class_obj_id] = fs.monthly_amount

    return student_fees, class_fees


def _summarize_scope(students, existing_ids, student_fees, class_fees, category_name=None, row_limit=50):
    """Summarize create/skip/no-structure counts and collect first preview rows."""
    will_create = 0
    already_exist = 0
    no_fee_structure = 0
    total_amount = Decimal('0')
    rows = []

    for student in students:
        if student.id in existing_ids:
            already_exist += 1
            continue

        amount = student_fees.get(student.id)
        if amount is None:
            amount = class_fees.get(student.class_obj_id)

        if amount is None:
            no_fee_structure += 1
            continue

        will_create += 1
        total_amount += amount

        if len(rows) < row_limit:
            row = {
                'student_id': student.id,
                'student_name': student.name,
                'class_name': student.class_obj.name if student.class_obj else '',
                'amount': str(amount),
            }
            if category_name is not None:
                row['category'] = category_name
            rows.append(row)

    return {
        'will_create': will_create,
        'already_exist': already_exist,
        'no_fee_structure': no_fee_structure,
        'total_amount': total_amount,
        'rows': rows,
    }


def plan_scope_records(
    *,
    school_id,
    students,
    fee_type,
    existing_ids,
    annual_category_id=None,
    monthly_category_id=None,
    row_limit=0,
    category_name=None,
    class_obj_id_getter=None,
    class_name_getter=None,
):
    """Plan creatable fee records for one scope using shared fee-resolution logic.

    Returns counts, total amount, optional preview rows, and creatable entries:
    [{'student': <Student>, 'amount': <Decimal>}].
    """
    students = list(students)
    today = date.today()

    student_fees, class_fees = _build_fee_maps(
        school_id,
        fee_type,
        today,
        annual_category_id=annual_category_id,
        monthly_category_id=monthly_category_id,
    )

    creatable = []
    rows = []
    will_create = 0
    already_exist = 0
    no_fee_structure = 0
    total_amount = Decimal('0')

    class_obj_id_getter = class_obj_id_getter or (lambda student: student.class_obj_id)
    class_name_getter = class_name_getter or (
        lambda student: student.class_obj.name if student.class_obj else ''
    )

    for student in students:
        if student.id in existing_ids:
            already_exist += 1
            continue

        amount = student_fees.get(student.id)
        if amount is None:
            amount = class_fees.get(class_obj_id_getter(student))

        if amount is None:
            no_fee_structure += 1
            continue

        creatable.append({'student': student, 'amount': amount})
        will_create += 1
        total_amount += amount

        if row_limit and len(rows) < row_limit:
            row = {
                'student_id': student.id,
                'student_name': student.name,
                'class_name': class_name_getter(student),
                'amount': str(amount),
            }
            if category_name is not None:
                row['category'] = category_name
            rows.append(row)

    return {
        'creatable': creatable,
        'will_create': will_create,
        'already_exist': already_exist,
        'no_fee_structure': no_fee_structure,
        'total_amount': total_amount,
        'rows': rows,
    }


def build_preview_plan(
    *,
    school_id,
    students,
    fee_type,
    year,
    month,
    annual_category_ids=None,
    monthly_category_ids=None,
    academic_year_id=None,
):
    """Build fee-generation preview output for monthly/annual/default flows."""
    students = list(students)
    row_limit = 50

    if not students:
        return {
            'will_create': 0,
            'already_exist': 0,
            'no_fee_structure': 0,
            'total_amount': '0',
            'students': [],
            'has_more': False,
        }

    today = date.today()

    enrollment_by_student = {}
    if academic_year_id:
        from academic_sessions.models import StudentEnrollment

        enrollment_qs = StudentEnrollment.objects.filter(
            school_id=school_id,
            academic_year_id=academic_year_id,
            is_active=True,
            student_id__in=[s.id for s in students],
        ).select_related('class_obj', 'session_class')
        enrollment_by_student = {e.student_id: e for e in enrollment_qs}

    def _class_obj_id_getter(student):
        enrollment = enrollment_by_student.get(student.id)
        if enrollment and enrollment.class_obj_id:
            return enrollment.class_obj_id
        return student.class_obj_id

    def _class_name_getter(student):
        enrollment = enrollment_by_student.get(student.id)
        if enrollment:
            if enrollment.session_class_id and enrollment.session_class:
                return enrollment.session_class.display_name
            if enrollment.class_obj_id and enrollment.class_obj:
                return enrollment.class_obj.name
        return student.class_obj.name if student.class_obj else ''

    # ANNUAL per-category preview
    if fee_type == 'ANNUAL' and annual_category_ids:
        categories = {
            c.id: c.name
            for c in AnnualFeeCategory.objects.filter(
                id__in=annual_category_ids,
                school_id=school_id,
            )
        }
        totals = {
            'will_create': 0,
            'already_exist': 0,
            'no_fee_structure': 0,
            'total_amount': Decimal('0'),
            'students': [],
        }

        for category_id, category_name in categories.items():
            existing_ids = set(
                FeePayment.objects.filter(
                    school_id=school_id,
                    month=0,
                    year=year,
                    fee_type='ANNUAL',
                    annual_category_id=category_id,
                ).values_list('student_id', flat=True)
            )
            summary = plan_scope_records(
                school_id=school_id,
                students=students,
                fee_type='ANNUAL',
                existing_ids=existing_ids,
                annual_category_id=category_id,
                category_name=category_name,
                row_limit=max(row_limit - len(totals['students']), 0),
                class_obj_id_getter=_class_obj_id_getter,
                class_name_getter=_class_name_getter,
            )
            totals['will_create'] += summary['will_create']
            totals['already_exist'] += summary['already_exist']
            totals['no_fee_structure'] += summary['no_fee_structure']
            totals['total_amount'] += summary['total_amount']
            if len(totals['students']) < row_limit:
                totals['students'].extend(summary['rows'])

        return {
            'will_create': totals['will_create'],
            'already_exist': totals['already_exist'],
            'no_fee_structure': totals['no_fee_structure'],
            'total_amount': str(totals['total_amount']),
            'students': totals['students'][:row_limit],
            'has_more': totals['will_create'] > row_limit,
        }

    # MONTHLY per-category preview
    if fee_type == 'MONTHLY' and monthly_category_ids:
        categories = {
            c.id: c.name
            for c in MonthlyFeeCategory.objects.filter(
                id__in=monthly_category_ids,
                school_id=school_id,
            )
        }
        totals = {
            'will_create': 0,
            'already_exist': 0,
            'no_fee_structure': 0,
            'total_amount': Decimal('0'),
            'students': [],
        }

        for category_id, category_name in categories.items():
            existing_ids = set(
                FeePayment.objects.filter(
                    school_id=school_id,
                    month=month,
                    year=year,
                    fee_type='MONTHLY',
                    monthly_category_id=category_id,
                ).values_list('student_id', flat=True)
            )
            summary = plan_scope_records(
                school_id=school_id,
                students=students,
                fee_type='MONTHLY',
                existing_ids=existing_ids,
                monthly_category_id=category_id,
                category_name=category_name,
                row_limit=max(row_limit - len(totals['students']), 0),
                class_obj_id_getter=_class_obj_id_getter,
                class_name_getter=_class_name_getter,
            )
            totals['will_create'] += summary['will_create']
            totals['already_exist'] += summary['already_exist']
            totals['no_fee_structure'] += summary['no_fee_structure']
            totals['total_amount'] += summary['total_amount']
            if len(totals['students']) < row_limit:
                totals['students'].extend(summary['rows'])

        return {
            'will_create': totals['will_create'],
            'already_exist': totals['already_exist'],
            'no_fee_structure': totals['no_fee_structure'],
            'total_amount': str(totals['total_amount']),
            'students': totals['students'][:row_limit],
            'has_more': totals['will_create'] > row_limit,
        }

    # Default preview (single scope: fee_type + month/year)
    existing_ids = set(
        FeePayment.objects.filter(
            school_id=school_id,
            month=month,
            year=year,
            fee_type=fee_type,
        ).values_list('student_id', flat=True)
    )
    summary = plan_scope_records(
        school_id=school_id,
        students=students,
        fee_type=fee_type,
        existing_ids=existing_ids,
        row_limit=row_limit,
        class_obj_id_getter=_class_obj_id_getter,
        class_name_getter=_class_name_getter,
    )

    return {
        'will_create': summary['will_create'],
        'already_exist': summary['already_exist'],
        'no_fee_structure': summary['no_fee_structure'],
        'total_amount': str(summary['total_amount']),
        'students': summary['rows'],
        'has_more': summary['will_create'] > row_limit,
    }