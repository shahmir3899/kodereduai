"""Optional (enrollment-billed) fee categories: who is enrolled when, and what they pay.

A category with billing_mode=ENROLLED bills only students with a StudentFeeEnrollment that
overlaps the billing period. Price, first match wins:
  enrollment.amount > student FeeStructure > class FeeStructure > category.default_amount.
The old uncategorised monthly override (monthly_category=NULL) is never used for these: it holds
a student's tuition, and would otherwise be billed again as "Robotics".
"""
import calendar
from datetime import date

from django.db.models import Q

from .models import AnnualFeeCategory, FeeBillingMode, MonthlyFeeCategory, StudentFeeEnrollment


def category_for(fee_type, annual_category_id=None, monthly_category_id=None):
    if fee_type == 'MONTHLY' and monthly_category_id:
        return MonthlyFeeCategory.objects.filter(id=monthly_category_id).first()
    if fee_type == 'ANNUAL' and annual_category_id:
        return AnnualFeeCategory.objects.filter(id=annual_category_id).first()
    return None


def is_enrolled_only(category):
    return bool(category) and category.billing_mode == FeeBillingMode.ENROLLED


def billing_period(fee_type, year, month=None, academic_year_id=None):
    """(first_day, last_day) an enrollment must overlap to be billed.

    Monthly: that calendar month. Annual: the academic year when known, else the calendar year.
    """
    if fee_type == 'MONTHLY' and month:
        return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    if academic_year_id:
        from academic_sessions.models import AcademicYear
        ay = AcademicYear.objects.filter(id=academic_year_id).only('start_date', 'end_date').first()
        if ay:
            return ay.start_date, ay.end_date
    return date(year, 1, 1), date(year, 12, 31)


def _category_filter(category):
    if isinstance(category, MonthlyFeeCategory):
        return {'monthly_category_id': category.id}
    return {'annual_category_id': category.id}


def enrollments_in_period(school_id, category, first_day, last_day, student_ids=None):
    """{student_id: enrollment} for enrollments overlapping [first_day, last_day].

    Overlap, not "enrolled on the 1st": joining mid-month is charged the full month.
    """
    qs = StudentFeeEnrollment.objects.filter(
        school_id=school_id, start_date__lte=last_day, **_category_filter(category),
    ).filter(Q(end_date__isnull=True) | Q(end_date__gte=first_day))
    if student_ids is not None:
        qs = qs.filter(student_id__in=student_ids)
    # Newest start wins when two overlap (e.g. re-joined at a new price).
    result = {}
    for enrollment in qs.order_by('start_date', 'id'):
        result[enrollment.student_id] = enrollment
    return result


def overlapping_enrollment(school_id, student_id, category, start_date, end_date, exclude_id=None):
    """An existing enrollment of this student in this category that overlaps the given dates."""
    qs = StudentFeeEnrollment.objects.filter(
        school_id=school_id, student_id=student_id, **_category_filter(category),
    ).filter(Q(end_date__isnull=True) | Q(end_date__gte=start_date))
    if end_date:
        qs = qs.filter(start_date__lte=end_date)
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.first()


def enrolled_price(enrollment, student_fee, class_fee, category):
    """First set price: enrollment, student structure, class structure, category default."""
    for value in (enrollment.amount if enrollment else None, student_fee, class_fee, category.default_amount):
        if value is not None:
            return value
    return None
