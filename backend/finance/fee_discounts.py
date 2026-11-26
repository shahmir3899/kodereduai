"""Discounts and scholarships taken off a bill, per fee category.

Who gets what comes from StudentDiscount assignments; which fees it cuts from the discount's or
scholarship's monthly_categories / annual_categories (school decision 2026-11-26: per fee type, any
category). A discount with no categories cuts nothing, so discounts that never applied before stay
inert until a school picks their fees.

Amount off one bill, from its own charge (``gross``, never the carried balance):
  * PERCENTAGE: gross x value / 100;  FIXED: value (per bill, i.e. per month for monthly fees);
    scholarship FULL: the whole charge.
  * Combining: a non-stackable discount stands alone; stackable discounts and scholarships add
    up. The best of those options wins, never more than the charge itself.

Generation stores the result on the row (FeePayment.discount_amount / discount_detail) and charges
the net amount, so the carry-forward ledger, balances and Kuickpay keep working on what is owed.
"""
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Q

from .models import MonthlyFeeCategory, StudentDiscount

ZERO = Decimal('0')
CENT = Decimal('0.01')


def _covers_q(category):
    field = 'monthly_categories' if isinstance(category, MonthlyFeeCategory) else 'annual_categories'
    return (
        Q(discount__isnull=False, discount__is_active=True, **{f'discount__{field}': category})
        | Q(scholarship__isnull=False, scholarship__is_active=True, **{f'scholarship__{field}': category})
    )


def rules_for(school_id, student_ids, category, first_day, last_day, academic_year_id=None):
    """{student_id: [rule]} for assignments that cut ``category`` during [first_day, last_day].

    A rule: {'name', 'kind': 'discount'|'scholarship', 'type', 'value', 'stackable'}.
    """
    if category is None or not student_ids:
        return {}
    qs = StudentDiscount.objects.filter(
        school_id=school_id, student_id__in=list(student_ids), is_active=True,
    ).filter(_covers_q(category)).select_related('discount', 'scholarship', 'academic_year')
    if academic_year_id:
        qs = qs.filter(academic_year_id=academic_year_id)
    else:
        # No year on the bill: the assignment's year must cover the billing period.
        qs = qs.filter(academic_year__start_date__lte=last_day, academic_year__end_date__gte=first_day)

    result = {}
    seen = set()
    for sd in qs:
        if sd.discount_id:
            d = sd.discount
            if (d.start_date and d.start_date > last_day) or (d.end_date and d.end_date < first_day):
                continue
            key = (sd.student_id, 'd', d.id)
            rule = {'name': d.name, 'kind': 'discount', 'type': d.discount_type, 'value': d.value,
                    'stackable': d.stackable}
        else:
            s = sd.scholarship
            key = (sd.student_id, 's', s.id)
            rule = {'name': s.name, 'kind': 'scholarship', 'type': s.coverage, 'value': s.value,
                    'stackable': True}
        if key in seen:  # the same discount assigned twice counts once
            continue
        seen.add(key)
        result.setdefault(sd.student_id, []).append(rule)
    return result


def _off(rule, gross):
    kind = rule['type']
    value = Decimal(rule['value'] or 0)
    if kind == 'FULL':
        return gross
    if kind == 'PERCENTAGE':
        return (gross * value / Decimal('100')).quantize(CENT, rounding=ROUND_HALF_UP)
    if kind == 'FIXED':
        return min(value, gross)
    return ZERO  # unknown coverage (old seed data): never guess at money


def apply(gross, rules):
    """(discount_amount, detail) for one bill of ``gross``. detail: [{'name', 'kind', 'amount'}]."""
    gross = Decimal(gross or 0)
    if gross <= ZERO or not rules:
        return ZERO, []
    priced = [(rule, _off(rule, gross)) for rule in rules]
    priced = [(rule, off) for rule, off in priced if off > ZERO]
    if not priced:
        return ZERO, []

    stacked = [(r, off) for r, off in priced if r['stackable']]
    options = [stacked] if stacked else []
    options += [[(r, off)] for r, off in priced if not r['stackable']]
    best = max(options, key=lambda opt: sum((off for _, off in opt), ZERO))

    detail, total = [], ZERO
    for rule, off in best:
        off = min(off, gross - total)  # never below a zero charge
        if off <= ZERO:
            break
        total += off
        detail.append({'name': rule['name'], 'kind': rule['kind'], 'amount': str(off)})
    return total, detail
