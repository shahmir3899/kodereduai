"""Shared planner for fee-generation previews.

This module batches fee structure and existing-payment lookups so preview
endpoints avoid per-student database calls.
"""

from django.utils import timezone
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


def _build_fee_maps(school_id, fee_type, today, annual_category_id=None, monthly_category_id=None,
                   legacy_fallback=True):
    """Build student and class fee maps from active structures.

    legacy_fallback=False skips the uncategorised monthly overrides: enrolled-only categories must
    never pick up a student's old tuition override as their price.
    """
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
    if legacy_fallback and fee_type == 'MONTHLY' and monthly_category_id is not None:
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
    year=None,
    month=None,
    academic_year_id=None,
):
    """Plan creatable fee records for one scope using shared fee-resolution logic.

    Returns counts, total amount, optional preview rows, and creatable entries:
    [{'student': <Student>, 'amount': <Decimal>}].

    For an enrolled-only category (finance.optional_fees) only students enrolled during the
    billing period (year/month, or the academic year for annual fees) are planned; the rest are
    counted as not_enrolled, never as missing a fee structure.

    Discounts and scholarships that cover the category (finance.fee_discounts) are taken off:
    each entry's 'amount' is what is charged, with 'gross', 'discount' and 'discount_detail'.
    """
    from . import fee_discounts, optional_fees

    students = list(students)
    today = timezone.localdate()

    category = optional_fees.category_for(fee_type, annual_category_id, monthly_category_id)
    enrolled_only = optional_fees.is_enrolled_only(category)
    enrollments = None
    discount_rules = {}
    if category is not None:
        first_day, last_day = optional_fees.billing_period(
            fee_type, year or today.year, month, academic_year_id,
        )
        if enrolled_only:
            enrollments = optional_fees.enrollments_in_period(
                school_id, category, first_day, last_day, student_ids=[s.id for s in students],
            )
        discount_rules = fee_discounts.rules_for(
            school_id, [s.id for s in students], category, first_day, last_day, academic_year_id,
        )

    student_fees, class_fees = _build_fee_maps(
        school_id,
        fee_type,
        today,
        annual_category_id=annual_category_id,
        monthly_category_id=monthly_category_id,
        legacy_fallback=not enrolled_only,
    )

    creatable = []
    rows = []
    will_create = 0
    already_exist = 0
    no_fee_structure = 0
    not_enrolled = 0
    total_amount = Decimal('0')

    # No enrollment map from the caller: the roster helpers' snapshot fallback.
    from academic_sessions.roster import placement_class_id, placement_label

    class_obj_id_getter = class_obj_id_getter or (lambda student: placement_class_id(None, student))
    class_name_getter = class_name_getter or (lambda student: placement_label(None, student))

    for student in students:
        if student.id in existing_ids:
            already_exist += 1
            continue

        if enrolled_only:
            enrollment = enrollments.get(student.id)
            if enrollment is None:
                not_enrolled += 1
                continue
            amount = optional_fees.enrolled_price(
                enrollment, student_fees.get(student.id), class_fees.get(class_obj_id_getter(student)), category,
            )
        else:
            amount = student_fees.get(student.id)
            if amount is None:
                amount = class_fees.get(class_obj_id_getter(student))

        if amount is None:
            no_fee_structure += 1
            continue

        gross = amount
        discount, discount_detail = fee_discounts.apply(gross, discount_rules.get(student.id))
        amount = gross - discount

        creatable.append({
            'student': student, 'amount': amount, 'gross': gross,
            'discount': discount, 'discount_detail': discount_detail,
        })
        will_create += 1
        total_amount += amount

        if row_limit and len(rows) < row_limit:
            row = {
                'student_id': student.id,
                'student_name': student.name,
                'class_name': class_name_getter(student),
                'amount': str(amount),
            }
            if discount:
                row['discount'] = str(discount)
            if category_name is not None:
                row['category'] = category_name
            rows.append(row)

    return {
        'creatable': creatable,
        'will_create': will_create,
        'already_exist': already_exist,
        'no_fee_structure': no_fee_structure,
        'not_enrolled': not_enrolled,
        # Students in scope enrolled in an optional fee (None for a fee everyone pays).
        'enrolled': len(enrollments) if enrolled_only else None,
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

    today = timezone.localdate()

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

    from academic_sessions.roster import placement_class_id, placement_label

    def _class_obj_id_getter(student):
        return placement_class_id(enrollment_by_student.get(student.id), student)

    def _class_name_getter(student):
        return placement_label(enrollment_by_student.get(student.id), student)

    # ANNUAL per-category preview
    if fee_type == 'ANNUAL' and annual_category_ids:
        category_rows = list(AnnualFeeCategory.objects.filter(id__in=annual_category_ids, school_id=school_id))
        categories = {c.id: c.name for c in category_rows}
        billing_modes = {c.id: c.billing_mode for c in category_rows}
        totals = {
            'will_create': 0,
            'already_exist': 0,
            'no_fee_structure': 0,
            'not_enrolled': 0,
            'total_amount': Decimal('0'),
            'students': [],
            'categories': [],
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
                year=year,
                academic_year_id=academic_year_id,
                row_limit=max(row_limit - len(totals['students']), 0),
                class_obj_id_getter=_class_obj_id_getter,
                class_name_getter=_class_name_getter,
            )
            totals['will_create'] += summary['will_create']
            totals['already_exist'] += summary['already_exist']
            totals['no_fee_structure'] += summary['no_fee_structure']
            totals['not_enrolled'] += summary['not_enrolled']
            # One line per fee type, so a run of several fees shows what each adds and, for an
            # optional fee, how many of the students in scope are enrolled.
            totals['categories'].append({
                'id': category_id,
                'name': category_name,
                'billing_mode': billing_modes.get(category_id, 'ALL'),
                'in_scope': len(students),
                'will_create': summary['will_create'],
                'already_exist': summary['already_exist'],
                'not_enrolled': summary['not_enrolled'],
                'enrolled': summary['enrolled'],
                'no_fee_structure': summary['no_fee_structure'],
                'total_amount': str(summary['total_amount']),
            })
            totals['total_amount'] += summary['total_amount']
            if len(totals['students']) < row_limit:
                totals['students'].extend(summary['rows'])

        return {
            'will_create': totals['will_create'],
            'already_exist': totals['already_exist'],
            'no_fee_structure': totals['no_fee_structure'],
            'not_enrolled': totals['not_enrolled'],
            'total_amount': str(totals['total_amount']),
            'categories': totals['categories'],
            'students': totals['students'][:row_limit],
            'has_more': totals['will_create'] > row_limit,
        }

    # MONTHLY per-category preview
    if fee_type == 'MONTHLY' and monthly_category_ids:
        category_rows = list(MonthlyFeeCategory.objects.filter(id__in=monthly_category_ids, school_id=school_id))
        categories = {c.id: c.name for c in category_rows}
        billing_modes = {c.id: c.billing_mode for c in category_rows}
        totals = {
            'will_create': 0,
            'already_exist': 0,
            'no_fee_structure': 0,
            'not_enrolled': 0,
            'total_amount': Decimal('0'),
            'students': [],
            'categories': [],
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
                year=year,
                month=month,
                academic_year_id=academic_year_id,
                row_limit=max(row_limit - len(totals['students']), 0),
                class_obj_id_getter=_class_obj_id_getter,
                class_name_getter=_class_name_getter,
            )
            totals['will_create'] += summary['will_create']
            totals['already_exist'] += summary['already_exist']
            totals['no_fee_structure'] += summary['no_fee_structure']
            totals['not_enrolled'] += summary['not_enrolled']
            # One line per fee type, so a run of several fees shows what each adds and, for an
            # optional fee, how many of the students in scope are enrolled.
            totals['categories'].append({
                'id': category_id,
                'name': category_name,
                'billing_mode': billing_modes.get(category_id, 'ALL'),
                'in_scope': len(students),
                'will_create': summary['will_create'],
                'already_exist': summary['already_exist'],
                'not_enrolled': summary['not_enrolled'],
                'enrolled': summary['enrolled'],
                'no_fee_structure': summary['no_fee_structure'],
                'total_amount': str(summary['total_amount']),
            })
            totals['total_amount'] += summary['total_amount']
            if len(totals['students']) < row_limit:
                totals['students'].extend(summary['rows'])

        return {
            'will_create': totals['will_create'],
            'already_exist': totals['already_exist'],
            'no_fee_structure': totals['no_fee_structure'],
            'not_enrolled': totals['not_enrolled'],
            'total_amount': str(totals['total_amount']),
            'categories': totals['categories'],
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