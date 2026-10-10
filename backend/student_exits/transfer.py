"""Branch transfers: the new student record at the destination, and the pending fees
that go with it.

A transfer is not a plain exit. The source branch keeps its record and history (the
student there simply ends on the leaving date); the destination branch gets a NEW
student record, linked back to the old one (Student.transferred_from), who starts on
the same date. Whatever the family still owes becomes the destination branch's to
collect: a receivable is created there and the source rows are marked as handed over
(not paid, not written off: the source books still show what was billed and paid).

Monthly fees carry as ONE opening balance row per monthly category, placed so the
destination's normal month-by-month generation continues from it (each month builds
on the previous calendar month's row). Annual charges carry one row per category that
still has something pending; nothing pending, no row. Credits (overpayments) are not
carried.
"""
from datetime import date as date_cls
from decimal import Decimal

from django.db import transaction

from academic_sessions.enrollment_service import sync_student_snapshot
from academic_sessions.models import AcademicYear, StudentEnrollment
from finance.models import AnnualFeeCategory, FeePayment, MonthlyFeeCategory
from finance.student_balance import student_pending_fees

from .models import EnrollmentBreak
from .services import ExitError

ZERO = Decimal('0')

# Personal and guardian details that move to the new record unchanged.
COPIED_FIELDS = (
    'name', 'date_of_birth', 'gender', 'blood_group', 'address', 'photo_url',
    'parent_name', 'parent_phone', 'guardian_name', 'guardian_relation', 'guardian_phone',
    'guardian_email', 'guardian_occupation', 'guardian_address', 'emergency_contact',
)


def destination_year(destination, leaving_date):
    """The destination branch's academic year the student joins: the one covering the
    leaving date, else its current year."""
    return (
        AcademicYear.objects.filter(
            school=destination, start_date__lte=leaving_date, end_date__gte=leaving_date,
        ).first()
        or AcademicYear.objects.filter(school=destination, is_current=True).first()
    )


def _roll_taken_at_destination(destination, year, session_class, roll_number):
    return StudentEnrollment.objects.filter(
        school=destination, academic_year=year, session_class=session_class, roll_number=roll_number,
        is_active=True,
    ).exists()


def check_placement(*, destination, leaving_date, session_class, roll_number, require=False):
    """Validate the class and roll chosen for the destination branch. With require
    False an empty choice is accepted (the wizard fills it in later); finalizing
    requires it. Returns the destination academic year (or None when not needed yet)."""
    roll_number = (roll_number or '').strip()
    if session_class is None and not roll_number:
        if require:
            raise ExitError('Choose the class and roll number the student will have at the new branch.')
        return None
    if destination is None:
        raise ExitError('Choose the branch the student is transferring to first.')
    year = destination_year(destination, leaving_date)
    if year is None:
        raise ExitError(f'{destination.name} has no academic year covering the leaving date.')
    if session_class is None:
        raise ExitError('Choose the class the student will join at the new branch.')
    if session_class.school_id != destination.id or session_class.academic_year_id != year.id:
        raise ExitError(f'Choose a class of {year.name} at {destination.name}.')
    if not roll_number:
        raise ExitError('Choose a roll number for the new branch.')
    if _roll_taken_at_destination(destination, year, session_class, roll_number):
        raise ExitError(f"Roll number '{roll_number}' is already taken in that class at {destination.name}.")
    return year


# ── Fees ─────────────────────────────────────────────────────────────────────

def _period_index(year, month):
    return year * 12 + month


def _opening_period(source_rows, leaving_date):
    """(year, month) for the monthly opening row: the latest month the source billed,
    but never earlier than the month before the leaving month. The destination bills
    from the leaving month on, and it takes each month's previous balance from the
    previous calendar month's row, so the carried balance has to sit right there."""
    prev_year, prev_month = (leaving_date.year, leaving_date.month - 1)
    if prev_month == 0:
        prev_year, prev_month = prev_year - 1, 12
    latest = max((_period_index(r['year'], r['month']) for r in source_rows), default=0)
    wanted = max(latest, _period_index(prev_year, prev_month))
    year, month = divmod(wanted - 1, 12)
    return year, month + 1


def fee_carry_plan(exit_case):
    """What would move to the destination if the pending fees were carried, in the
    shape the wizard shows: one line per charge, in the destination's terms. Computed
    live from the source books. Returns None when it is not a transfer or nothing is
    pending."""
    if exit_case.exit_type != exit_case.ExitType.TRANSFERRED or exit_case.destination_school_id is None:
        return None
    pending = student_pending_fees(exit_case.student)
    if not pending['items']:
        return None

    destination = exit_case.destination_school
    monthly_names = {c.name.lower(): c for c in MonthlyFeeCategory.objects.filter(school=destination)}
    annual_names = {c.name.lower(): c for c in AnnualFeeCategory.objects.filter(school=destination)}

    monthly_items = [i for i in pending['items'] if i['fee_type'] == 'MONTHLY']
    annual_items = [i for i in pending['items'] if i['fee_type'] != 'MONTHLY']
    open_year, open_month = (
        _opening_period(monthly_items, exit_case.leaving_date) if monthly_items else (None, None)
    )

    lines = []
    for item in monthly_items:
        lines.append({
            'fee_type': 'MONTHLY', 'label': item['label'], 'balance': item['balance'],
            'month': open_month, 'year': open_year,
            'category_exists': item['label'].lower() in monthly_names,
            'payment_id': item['payment_id'],
        })
    for item in annual_items:
        lines.append({
            'fee_type': item['fee_type'], 'label': item['label'], 'balance': item['balance'],
            'month': 0, 'year': item['year'],
            'category_exists': item['label'].lower() in annual_names,
            'payment_id': item['payment_id'],
        })
    return {
        'destination': destination.name,
        'total': sum((line['balance'] for line in lines), ZERO),
        'lines': lines,
    }


def serialize_plan(plan):
    if plan is None:
        return None
    return {
        'destination': plan['destination'],
        'total': str(plan['total']),
        'lines': [
            {k: (str(v) if isinstance(v, Decimal) else v) for k, v in line.items() if k != 'payment_id'}
            for line in plan['lines']
        ],
    }


def _destination_category(model, destination, label):
    """The destination's category with this name, created when it does not exist."""
    existing = model.objects.filter(school=destination, name__iexact=label).first()
    if existing:
        return existing
    return model.objects.create(school=destination, name=label, is_active=True)


def _carry_fees(exit_case, new_student, year):
    """Create the destination rows and mark the source rows handed over. Returns the
    plan (for the snapshot) or None when there was nothing to carry."""
    plan = fee_carry_plan(exit_case)
    if plan is None:
        return None
    destination = exit_case.destination_school
    note = (
        f'Carried from {exit_case.school.name} when the student transferred on '
        f'{exit_case.leaving_date.isoformat()}.'
    )
    handed_over = []
    for line in plan['lines']:
        balance = line['balance']
        if line['fee_type'] == 'MONTHLY':
            category = _destination_category(MonthlyFeeCategory, destination, line['label'])
            FeePayment.objects.create(
                school=destination, academic_year=year, student=new_student,
                fee_type='MONTHLY', monthly_category=category,
                month=line['month'], year=line['year'],
                amount_due=balance, previous_balance=balance, base_monthly_fee=ZERO,
                amount_paid=ZERO, status=FeePayment.PaymentStatus.UNPAID,
                notes=note, carried_from_exit=exit_case,
            )
        else:
            category = _destination_category(AnnualFeeCategory, destination, line['label'])
            FeePayment.objects.create(
                school=destination, academic_year=year, student=new_student,
                fee_type=line['fee_type'], annual_category=category,
                month=0, year=line['year'],
                amount_due=balance, previous_balance=ZERO, amount_paid=ZERO,
                status=FeePayment.PaymentStatus.UNPAID, notes=note, carried_from_exit=exit_case,
            )
        handed_over.append(line['payment_id'])
    FeePayment.objects.filter(pk__in=handed_over).update(handed_over_to_exit=exit_case)
    return plan


# ── The new record ───────────────────────────────────────────────────────────

def _copy_parent_links(student, new_student, destination):
    """Parents follow the child: same parent accounts, linked to the new record and
    allowed to sign in at the destination branch."""
    from parents.models import ParentChild
    from schools.models import UserSchoolMembership

    for link in ParentChild.objects.filter(student=student).select_related('parent__user'):
        ParentChild.objects.get_or_create(
            parent=link.parent, student=new_student,
            defaults={
                'school': destination, 'relation': link.relation,
                'is_primary': link.is_primary, 'can_pickup': link.can_pickup,
            },
        )
        UserSchoolMembership.objects.get_or_create(
            user=link.parent.user, school=destination,
            defaults={'role': 'PARENT', 'is_active': True, 'is_default': False},
        )


def complete_transfer(exit_case):
    """Create the student at the destination (record, enrollment, parents, the days
    before they joined excluded) and carry the pending fees if that was chosen.
    Runs inside finalize_exit's transaction. Returns the snapshot of what was done."""
    from students.models import Student
    from .models import ExitClearanceItem

    destination = exit_case.destination_school
    source = exit_case.student
    session_class = exit_case.destination_session_class
    roll = (exit_case.destination_roll_number or '').strip()
    year = check_placement(
        destination=destination, leaving_date=exit_case.leaving_date,
        session_class=session_class, roll_number=roll, require=True,
    )

    new_student = Student.objects.create(
        school=destination, class_obj=session_class.class_obj, roll_number=roll,
        admission_date=exit_case.leaving_date, previous_school=exit_case.school.name,
        status=Student.Status.ACTIVE, status_date=exit_case.leaving_date,
        transferred_from=source,
        **{field: getattr(source, field) for field in COPIED_FIELDS},
    )
    StudentEnrollment.objects.create(
        school=destination, student=new_student, academic_year=year,
        class_obj=session_class.class_obj, session_class=session_class,
        roll_number=roll, status=StudentEnrollment.Status.ACTIVE,
    )
    sync_student_snapshot(new_student)

    # The new record exists for the whole destination year, so the days before the
    # student joined are marked as not theirs: no attendance, fees or exam roster
    # there, exactly like a gap in a re-admitted student's record.
    if year.start_date < exit_case.leaving_date:
        EnrollmentBreak.objects.create(
            school=destination, student=new_student, exit=exit_case,
            start_date=year.start_date, end_date=exit_case.leaving_date,
            reason=f'Joined from {exit_case.school.name} on {exit_case.leaving_date.isoformat()}',
        )

    _copy_parent_links(source, new_student, destination)

    carried = exit_case.items.filter(
        kind=ExitClearanceItem.Kind.FEES, state=ExitClearanceItem.State.CARRIED,
    ).exists()
    plan = _carry_fees(exit_case, new_student, year) if carried else None

    exit_case.destination_student = new_student
    return {
        'destination_student_id': new_student.id,
        'destination_school': destination.name,
        'class': getattr(session_class, 'display_name', None) or str(session_class),
        'roll_number': roll,
        'academic_year': year.name,
        'fees_carried': serialize_plan(plan),
    }
