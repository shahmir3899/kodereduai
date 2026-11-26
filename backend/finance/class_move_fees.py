"""Fee impact of moving a student to a different master class mid-year.

Fees are set per master class, so a move between sections of one class changes
nothing. Moving to another master class changes the monthly fee from the move on:
months not yet generated simply use the new class (generation reads the student's
current enrollment). Months already generated keep their stored amounts unless the
admin chooses to re-price them. Paid money is never touched: re-pricing only runs
over a tail of months with nothing paid, and annual / one-time fees are never
changed (they stay with the class the student was in when they were charged).
"""
from decimal import Decimal

from django.db import transaction

from .generation_planner import _build_fee_maps
from .models import FeePayment, MonthlyClosing, MonthlyFeeCategory

KEEP = 'keep'
REPRICE = 'reprice'


def _period(year, month):
    return year * 12 + month


def _fee_for(category_id, student, class_obj_id, school_id, today):
    from . import optional_fees
    category = MonthlyFeeCategory.objects.filter(id=category_id).first()
    enrolled_only = optional_fees.is_enrolled_only(category)
    student_fees, class_fees = _build_fee_maps(
        school_id, 'MONTHLY', today, monthly_category_id=category_id, legacy_fallback=not enrolled_only,
    )
    if enrolled_only:
        # A price on the enrollment is the student's own and does not move with the class;
        # with no class price the category price applies in both classes.
        first_day, last_day = optional_fees.billing_period('MONTHLY', today.year, today.month)
        enrollment = optional_fees.enrollments_in_period(
            school_id, category, first_day, last_day, student_ids=[student.id],
        ).get(student.id)
        if enrollment and enrollment.amount is not None:
            return enrollment.amount, True
    if student.id in student_fees:
        return student_fees[student.id], True
    fee = class_fees.get(class_obj_id)
    if fee is None and enrolled_only:
        fee = category.default_amount
    return fee, False


def fee_impact(student, *, academic_year, old_class_obj_id, new_class_obj_id, effective_date, today=None):
    """What the move does to fees. ``applies`` is False when the master class is the
    same (a section move), in which case there is nothing to show or choose."""
    from datetime import date as date_cls

    today = today or date_cls.today()
    if not old_class_obj_id or old_class_obj_id == new_class_obj_id:
        return {'applies': False}

    school_id = student.school_id
    from_period = _period(effective_date.year, effective_date.month)
    rows = list(
        FeePayment.objects.filter(
            student=student, fee_type='MONTHLY', academic_year=academic_year,
        ).select_related('monthly_category').order_by('year', 'month')
    )
    closed = set(MonthlyClosing.objects.filter(school_id=school_id).values_list('year', 'month'))

    categories = []
    blockers = []
    can_reprice = True
    affected_total = 0
    for category in MonthlyFeeCategory.objects.filter(school_id=school_id, is_active=True).order_by('id'):
        old_fee, old_is_override = _fee_for(category.id, student, old_class_obj_id, school_id, today)
        new_fee, new_is_override = _fee_for(category.id, student, new_class_obj_id, school_id, today)
        months = [
            r for r in rows
            if r.monthly_category_id == category.id and _period(r.year, r.month) >= from_period
        ]
        paid = [r for r in months if (r.amount_paid or 0) > 0]
        in_closed = [r for r in months if (r.year, r.month) in closed]
        if paid:
            blockers.append(f'{category.name}: {len(paid)} month(s) from {effective_date:%B %Y} already have payments.')
        if in_closed:
            blockers.append(f'{category.name}: {len(in_closed)} month(s) are in a closed period.')
        affected_total += len(months)
        categories.append({
            'category_id': category.id, 'name': category.name,
            'old_fee': str(old_fee) if old_fee is not None else None,
            'new_fee': str(new_fee) if new_fee is not None else None,
            'student_override': old_is_override or new_is_override,
            'months_from_move': [
                {'month': r.month, 'year': r.year, 'amount_due': str(r.amount_due),
                 'amount_paid': str(r.amount_paid or 0), 'status': r.status}
                for r in months
            ],
        })
    if blockers or not affected_total:
        can_reprice = False
    return {
        'applies': True,
        'from_month': {'month': effective_date.month, 'year': effective_date.year},
        'categories': categories,
        'can_reprice': can_reprice,
        'blockers': blockers,
        'annual_note': 'Annual and one-time fees stay with the old class and are not changed.',
    }


@transaction.atomic
def reprice_months(student, *, academic_year, new_class_obj_id, effective_date, today=None):
    """Re-price the student's unpaid monthly rows from the month of ``effective_date``
    to the new class's fee, rebuilding each month's carried balance in order. Raises
    ValueError if any affected row has a payment or sits in a closed period. Returns
    [{category, month, year, old_due, new_due}]."""
    from datetime import date as date_cls

    today = today or date_cls.today()
    school_id = student.school_id
    from_period = _period(effective_date.year, effective_date.month)
    closed = set(MonthlyClosing.objects.filter(school_id=school_id).values_list('year', 'month'))
    changes = []

    from . import fee_discounts, optional_fees

    for category in MonthlyFeeCategory.objects.filter(school_id=school_id, is_active=True).order_by('id'):
        new_fee, overridden = _fee_for(category.id, student, new_class_obj_id, school_id, today)
        if new_fee is None or overridden:
            continue  # no fee set for the new class, or a per-student fee that does not move
        rows = list(
            FeePayment.objects.select_for_update().filter(
                student=student, fee_type='MONTHLY', academic_year=academic_year, monthly_category=category,
            ).order_by('year', 'month')
        )
        previous = None
        for row in rows:
            if _period(row.year, row.month) < from_period:
                previous = row
                continue
            if (row.amount_paid or 0) > 0:
                raise ValueError(f'{category.name} {row.month}/{row.year} already has a payment.')
            if (row.year, row.month) in closed:
                raise ValueError(f'{row.month}/{row.year} is in a closed period.')
            carried = (
                (previous.amount_due or Decimal('0')) - (previous.amount_paid or Decimal('0'))
                if previous is not None else (row.previous_balance or Decimal('0'))
            )
            old_due = row.amount_due
            # The new class's fee, less the discounts that cover this fee that month.
            first_day, last_day = optional_fees.billing_period('MONTHLY', row.year, row.month)
            discount, detail = fee_discounts.apply(new_fee, fee_discounts.rules_for(
                school_id, [student.id], category, first_day, last_day, academic_year.id,
            ).get(student.id))
            row.previous_balance = carried
            row.base_monthly_fee = new_fee - discount
            row.discount_amount = discount
            row.discount_detail = detail
            row.amount_due = carried + row.base_monthly_fee
            row.compute_status()
            row.save()
            changes.append({
                'category': category.name, 'month': row.month, 'year': row.year,
                'old_due': str(old_due), 'new_due': str(row.amount_due),
            })
            previous = row
    return changes
