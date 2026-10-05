"""Student exit workflow: open a case, compute and waive clearance, finalize or cancel.

Views stay thin and call these. Everything that changes data on finalize runs in
one transaction, so a failure part-way leaves the student untouched.
"""
from datetime import date as date_cls, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from academic_sessions.enrollment_service import move_student, sync_student_snapshot
from academic_sessions.leaving import (
    DEPARTED_STATUSES, apply_departure, records_after_leaving,
)
from academic_sessions.models import AcademicYear, StudentEnrollment
from core.audit import log_admin_action
from finance.student_balance import student_pending_fees

from .models import EnrollmentBreak, ExitClearanceItem, StudentExit

WAIVER_REASON_MIN_LENGTH = 10
Kind = ExitClearanceItem.Kind
State = ExitClearanceItem.State


class ExitError(Exception):
    """A rule of the workflow was broken; `message` is safe to show the user and
    `payload` (optional) is the structured body for the API response."""

    def __init__(self, message, payload=None):
        super().__init__(message)
        self.message = message
        self.payload = payload or {'detail': message}


class RecordsAfterLeaving(ExitError):
    """The chosen leaving date would strand attendance/marks recorded after it.
    The payload is the same summary the Update Status dialog already renders."""


class ClearanceIncomplete(ExitError):
    def __init__(self, items):
        names = ', '.join(i.get_kind_display().lower() for i in items)
        super().__init__(
            f'Clear or waive every open item before finalizing: {names}.',
            {
                'code': 'clearance_incomplete',
                'detail': f'Clear or waive every open item before finalizing: {names}.',
                'open_items': [i.kind for i in items],
            },
        )


# ── Clearance ────────────────────────────────────────────────────────────────

def _money(value):
    text = f'{Decimal(value):,.2f}'
    return text[:-3] if text.endswith('.00') else text


def _fees_check(student):
    pending = student_pending_fees(student)
    total = pending['total']
    if total <= 0:
        return None
    return {
        'summary': f'PKR {_money(total)} pending',
        'amount': total,
        'fingerprint': f'{total:.2f}',
        'detail': {
            'items': [
                {
                    'label': i['label'], 'fee_type': i['fee_type'],
                    'month': i['month'], 'year': i['year'], 'balance': str(i['balance']),
                }
                for i in pending['items']
            ],
        },
    }


def _library_check(student):
    from library.models import BookIssue

    issues = list(
        BookIssue.objects.filter(student=student, status__in=['ISSUED', 'OVERDUE'])
        .select_related('book').order_by('due_date', 'id')
    )
    if not issues:
        return None
    return {
        'summary': f'{len(issues)} book{"s" if len(issues) != 1 else ""} not returned',
        'amount': None,
        'fingerprint': ','.join(str(i.id) for i in issues),
        'detail': {
            'books': [
                {'id': i.id, 'title': getattr(i.book, 'title', str(i.book)), 'due_date': i.due_date.isoformat(),
                 'status': i.status}
                for i in issues
            ],
        },
    }


def _gate_pass_check(student):
    """Only a student who is out right now (checked out, not yet back) blocks an
    exit; passes that were never used are expired automatically on finalize."""
    from hostel.models import GatePass

    passes = list(GatePass.objects.filter(student=student, status='USED', actual_return__isnull=True).order_by('id'))
    if not passes:
        return None
    return {
        'summary': f'{len(passes)} gate pass{"es" if len(passes) != 1 else ""} still out',
        'amount': None,
        'fingerprint': ','.join(str(p.id) for p in passes),
        'detail': {
            'passes': [
                {'id': p.id, 'going_to': p.going_to, 'departure_date': p.departure_date.isoformat()}
                for p in passes
            ],
        },
    }


CHECKS = {
    Kind.FEES: _fees_check,
    Kind.LIBRARY: _library_check,
    Kind.GATE_PASS: _gate_pass_check,
}


def refresh_clearance(exit_case):
    """Recompute every item from live data. A waiver survives only while the
    situation it was granted for is unchanged."""
    existing = {item.kind: item for item in exit_case.items.all()}
    for kind, check in CHECKS.items():
        result = check(exit_case.student)
        item = existing.get(kind) or ExitClearanceItem(exit=exit_case, kind=kind)

        if result is None:
            item.state = State.CLEAR
            item.summary = ''
            item.detail = {}
            item.amount = None
            item.waived_fingerprint = ''
        else:
            # A waiver, or a decision to carry the fees to the new branch, holds only
            # while the situation is the one it was made for.
            still_decided = (
                item.state in (State.WAIVED, State.CARRIED)
                and item.waived_fingerprint == result['fingerprint']
            )
            item.summary = result['summary']
            item.detail = result['detail']
            item.amount = result['amount']
            if still_decided:
                pass  # state (WAIVED or CARRIED) stays as decided
            else:
                item.state = State.OPEN
                item.waived_fingerprint = ''
                item.waiver_reason = ''
                item.waived_by = None
                item.waived_at = None
        item.save()
    return list(exit_case.items.all())


def _current_fingerprint(student, kind):
    result = CHECKS[kind](student)
    return result['fingerprint'] if result else None


def waive_item(exit_case, kind, reason, user):
    _require_open(exit_case)
    reason = (reason or '').strip()
    if len(reason) < WAIVER_REASON_MIN_LENGTH:
        raise ExitError(f'Give a reason of at least {WAIVER_REASON_MIN_LENGTH} characters to waive this item.')
    refresh_clearance(exit_case)
    item = exit_case.items.get(kind=kind)
    if item.state == State.CLEAR:
        raise ExitError('Nothing to waive: this item is already clear.')
    item.state = State.WAIVED
    item.waiver_reason = reason
    item.waived_by = user
    item.waived_at = timezone.now()
    item.waived_fingerprint = _current_fingerprint(exit_case.student, kind) or ''
    item.save()
    return item


def carry_item(exit_case, kind, user):
    """Transfers only, fees only: hand the pending balance to the destination branch.
    Counts as clearing the item; the receivable is created there when the transfer is
    finalized."""
    _require_open(exit_case)
    if kind != Kind.FEES:
        raise ExitError('Only pending fees can be carried to the new branch.')
    if exit_case.exit_type != StudentExit.ExitType.TRANSFERRED or exit_case.destination_school_id is None:
        raise ExitError('Fees can only be carried to the new branch in a transfer.')
    refresh_clearance(exit_case)
    item = exit_case.items.get(kind=kind)
    if item.state == State.CLEAR:
        raise ExitError('Nothing to carry: there are no pending fees.')
    item.state = State.CARRIED
    item.waiver_reason = f'Carried to {exit_case.destination_school.name}'
    item.waived_by = user
    item.waived_at = timezone.now()
    item.waived_fingerprint = _current_fingerprint(exit_case.student, kind) or ''
    item.save()
    return item


def unwaive_item(exit_case, kind):
    """Undo a waiver, or a decision to carry the item to the new branch."""
    _require_open(exit_case)
    item = exit_case.items.get(kind=kind)
    if item.state not in (State.WAIVED, State.CARRIED):
        raise ExitError('This item is not waived or carried.')
    item.state = State.OPEN
    item.waived_fingerprint = ''
    item.waiver_reason = ''
    item.waived_by = None
    item.waived_at = None
    item.save()
    return item


# ── Lifecycle ────────────────────────────────────────────────────────────────

def _require_open(exit_case):
    if exit_case.status != StudentExit.Status.OPEN:
        raise ExitError('This exit is no longer open.')


def _check_destination(school, exit_type, destination):
    if exit_type == StudentExit.ExitType.TRANSFERRED:
        if destination is None:
            raise ExitError('Choose the branch the student is transferring to.')
        if destination.id == school.id:
            raise ExitError('The destination must be a different school.')
        if not school.organization_id or destination.organization_id != school.organization_id:
            raise ExitError('A student can only be transferred to another school of the same organization.')
        if not destination.is_active:
            raise ExitError('The destination school is not active.')
    elif destination is not None:
        raise ExitError('A destination school applies only to transfers.')


def _check_leaving_records(student, leaving_date, remove_records):
    if remove_records:
        return
    _attendance, _marks, summary = records_after_leaving(student, leaving_date)
    if summary is not None:
        raise RecordsAfterLeaving(summary['detail'], summary)


def open_exit(*, student, exit_type, leaving_date, reason='', destination_school=None,
              remove_records=False, user=None, destination_session_class=None,
              destination_roll_number=''):
    if student.status in DEPARTED_STATUSES:
        raise ExitError(f'{student.name} has already left. Re-admit them before starting another exit.')
    if StudentExit.objects.filter(student=student, status=StudentExit.Status.OPEN).exists():
        raise ExitError(f'{student.name} already has an exit in progress.')
    if not isinstance(leaving_date, date_cls):
        raise ExitError('A leaving date is required.')
    _check_destination(student.school, exit_type, destination_school)
    _check_leaving_records(student, leaving_date, remove_records)
    if exit_type == StudentExit.ExitType.TRANSFERRED:
        from . import transfer
        transfer.check_placement(
            destination=destination_school, leaving_date=leaving_date,
            session_class=destination_session_class, roll_number=destination_roll_number,
        )
    elif destination_session_class is not None or (destination_roll_number or '').strip():
        raise ExitError('A class at the new branch applies only to transfers.')

    with transaction.atomic():
        exit_case = StudentExit.objects.create(
            school=student.school, student=student, exit_type=exit_type,
            leaving_date=leaving_date, reason=reason or '',
            destination_school=destination_school,
            destination_session_class=destination_session_class,
            destination_roll_number=(destination_roll_number or '').strip(),
            remove_records_after_leaving=remove_records, requested_by=user,
        )
        refresh_clearance(exit_case)
    return exit_case


def update_exit(exit_case, *, leaving_date=None, reason=None, destination_school=None,
                destination_given=False, remove_records=None, placement_given=False,
                destination_session_class=None, destination_roll_number=''):
    _require_open(exit_case)
    new_date = leaving_date or exit_case.leaving_date
    new_remove = exit_case.remove_records_after_leaving if remove_records is None else remove_records
    new_destination = destination_school if destination_given else exit_case.destination_school
    _check_destination(exit_case.school, exit_case.exit_type, new_destination)
    _check_leaving_records(exit_case.student, new_date, new_remove)

    if exit_case.exit_type == StudentExit.ExitType.TRANSFERRED:
        from . import transfer
        if placement_given:
            new_class, new_roll = destination_session_class, (destination_roll_number or '').strip()
        elif new_destination != exit_case.destination_school or new_date != exit_case.leaving_date:
            # A different branch (or date, hence maybe a different year) invalidates
            # the class picked before: choose again.
            new_class, new_roll = None, ''
        else:
            new_class, new_roll = exit_case.destination_session_class, exit_case.destination_roll_number
        transfer.check_placement(
            destination=new_destination, leaving_date=new_date,
            session_class=new_class, roll_number=new_roll,
        )
        exit_case.destination_session_class = new_class
        exit_case.destination_roll_number = new_roll

    exit_case.leaving_date = new_date
    exit_case.remove_records_after_leaving = new_remove
    exit_case.destination_school = new_destination
    if reason is not None:
        exit_case.reason = reason
    exit_case.save()
    return exit_case


def _deactivate_portal_login(student):
    """Turn off the student's own login at this school. Only the membership is
    deactivated: the user may hold other roles. Parent links are left alone, so
    parents keep (read-only) access to the history."""
    from schools.models import UserSchoolMembership

    profile = getattr(student, 'user_profile', None)
    if profile is None:
        return 0
    return UserSchoolMembership.objects.filter(
        user_id=profile.user_id, school_id=student.school_id, is_active=True,
    ).update(is_active=False)


def _close_school_services(student, leaving_date):
    from hostel.models import GatePass, HostelAllocation
    from transport.models import TransportAssignment

    HostelAllocation.objects.filter(student=student, is_active=True).update(
        is_active=False, vacated_date=leaving_date,
    )
    TransportAssignment.objects.filter(student=student, is_active=True).update(is_active=False)
    GatePass.objects.filter(student=student, status__in=['PENDING', 'APPROVED']).update(status='EXPIRED')


def ensure_open_break(student, start_date, exit_case=None):
    """Record the start of an absence. A stale open break (nothing should leave one,
    since a departed student cannot leave again) is reused, not duplicated."""
    return EnrollmentBreak.objects.update_or_create(
        student=student, end_date__isnull=True,
        defaults={
            'school': student.school, 'exit': exit_case, 'start_date': start_date,
        },
    )[0]


def _open_break(exit_case):
    ensure_open_break(exit_case.student, exit_case.leaving_date, exit_case)


def _snapshot(exit_case, items):
    student = exit_case.student
    return {
        'class_name': getattr(student.class_obj, 'name', None),
        'roll_number': student.roll_number,
        'pending_fees': str(student_pending_fees(student)['total']),
        'clearance': [
            {
                'kind': i.kind, 'state': i.state, 'summary': i.summary,
                'amount': str(i.amount) if i.amount is not None else None,
                'waiver_reason': i.waiver_reason,
                'waived_by': getattr(i.waived_by, 'username', None),
                'waived_at': i.waived_at.isoformat() if i.waived_at else None,
            }
            for i in items
        ],
    }


def finalize_exit(exit_case, user, request=None):
    with transaction.atomic():
        exit_case = StudentExit.objects.select_for_update().get(pk=exit_case.pk)
        _require_open(exit_case)
        student = exit_case.student

        items = refresh_clearance(exit_case)
        blocking = [i for i in items if i.state == State.OPEN]
        if blocking:
            raise ClearanceIncomplete(blocking)
        _check_leaving_records(student, exit_case.leaving_date, exit_case.remove_records_after_leaving)
        is_transfer = exit_case.exit_type == StudentExit.ExitType.TRANSFERRED
        if is_transfer:
            from . import transfer
            transfer.check_placement(
                destination=exit_case.destination_school, leaving_date=exit_case.leaving_date,
                session_class=exit_case.destination_session_class,
                roll_number=exit_case.destination_roll_number, require=True,
            )

        apply_departure(
            student, exit_case.exit_type, exit_case.leaving_date, exit_case.reason,
            remove_records=exit_case.remove_records_after_leaving, request=request,
        )
        _close_school_services(student, exit_case.leaving_date)
        _deactivate_portal_login(student)
        _open_break(exit_case)

        # Taken before the transfer hands the fees over, so the snapshot shows what was
        # owed at the moment of leaving.
        exit_case.snapshot = _snapshot(exit_case, items)
        if is_transfer:
            exit_case.snapshot['transfer'] = transfer.complete_transfer(exit_case)
        exit_case.status = StudentExit.Status.FINALIZED
        exit_case.finalized_by = user
        exit_case.finalized_at = timezone.now()
        exit_case.save()

        log_admin_action(request, 'student_exit_finalized', student, metadata={
            'exit_id': exit_case.id,
            'exit_type': exit_case.exit_type,
            'leaving_date': exit_case.leaving_date.isoformat(),
            'destination_school_id': exit_case.destination_school_id,
            'destination_student_id': exit_case.destination_student_id,
            'clearance': exit_case.snapshot['clearance'],
        })
    return exit_case


def cancel_exit(exit_case, user, reason='', request=None):
    _require_open(exit_case)
    exit_case.status = StudentExit.Status.CANCELLED
    exit_case.cancelled_by = user
    exit_case.cancelled_at = timezone.now()
    exit_case.cancel_reason = (reason or '').strip()
    exit_case.save()
    log_admin_action(request, 'student_exit_cancelled', exit_case.student, metadata={
        'exit_id': exit_case.id, 'reason': exit_case.cancel_reason,
    })
    return exit_case


# ── Re-admission ─────────────────────────────────────────────────────────────

def activate_portal_login(student):
    """Switch the student's own login back on at this school (the exit switched it off)."""
    from schools.models import UserSchoolMembership

    profile = getattr(student, 'user_profile', None)
    if profile is None:
        return 0
    return UserSchoolMembership.objects.filter(
        user_id=profile.user_id, school_id=student.school_id, is_active=False,
    ).update(is_active=True)


def _away_since(student, open_break):
    """The day the student left: from the open break, else (an exit that predates
    breaks, or a re-activation through the old status dialog) from the enrollment."""
    if open_break:
        return open_break.start_date
    latest = (
        StudentEnrollment.objects.filter(student=student, left_date__isnull=False)
        .order_by('-academic_year__start_date', '-id').first()
    )
    return (latest.left_date if latest else None) or student.status_date


def close_break_on_return(student, *, return_date, previous_start=None, reason='', user=None):
    """Close the student's open break on ``return_date``. With no open break (an exit
    from before breaks existed, or a plain status change) one is recorded from
    ``previous_start`` so the gap is not forgotten. Returns the break, or None when
    there was nothing to record."""
    open_break = EnrollmentBreak.objects.filter(student=student, end_date__isnull=True).first()
    start = open_break.start_date if open_break else previous_start
    if start is None:
        return None
    end = return_date if return_date > start else start + timedelta(days=1)
    if open_break:
        open_break.end_date = end
        open_break.reason = reason
        open_break.readmitted_by = user
        open_break.readmitted_at = timezone.now()
        open_break.save()
        return open_break
    return EnrollmentBreak.objects.create(
        school=student.school, student=student, start_date=start, end_date=end,
        reason=reason, readmitted_by=user, readmitted_at=timezone.now(),
    )


def _roll_taken(school_id, academic_year_id, session_class, class_obj_id, roll_number, student):
    """Same rule as the roll constraints: unique per section, or per master class for
    enrollments with no section."""
    taken = StudentEnrollment.objects.filter(
        school_id=school_id, academic_year_id=academic_year_id, roll_number=roll_number,
    ).exclude(student=student)
    taken = taken.filter(session_class=session_class) if session_class else taken.filter(
        session_class__isnull=True, class_obj_id=class_obj_id,
    )
    return taken.exists()


def readmit_student(*, student, return_date, session_class=None, roll_number=None,
                    reason='', user=None, request=None):
    """Bring a withdrawn/transferred student back: same Student record, so every old
    attendance, mark and fee row stays attached; the months away stay empty because
    the break is closed rather than deleted.

    Same academic year as they left in: that enrollment is re-activated (and moved
    when a section or roll is given). A later year: a new enrollment, which needs a
    section and roll. The return date may be in the future."""
    if student.status not in DEPARTED_STATUSES:
        raise ExitError(f'{student.name} has not left, so there is nothing to re-admit.')
    if not isinstance(return_date, date_cls):
        raise ExitError('A return date is required.')

    open_break = EnrollmentBreak.objects.filter(student=student, end_date__isnull=True).first()
    left_on = _away_since(student, open_break)
    if left_on is None:
        raise ExitError("We can't tell when this student left, so the gap can't be recorded. "
                        'Ask an administrator to record the leaving date first.')
    if return_date <= left_on:
        raise ExitError(f'The return date must be after the day they left ({left_on.isoformat()}).')

    year = (
        AcademicYear.objects.filter(school=student.school, start_date__lte=return_date, end_date__gte=return_date).first()
        or AcademicYear.objects.filter(school=student.school, is_current=True).first()
    )
    if year is None:
        raise ExitError('No academic year covers the return date.')

    if session_class is not None and (
        session_class.school_id != student.school_id or session_class.academic_year_id != year.id
    ):
        raise ExitError(f'Choose a class of {year.name} at this school.')

    enrollment = StudentEnrollment.objects.filter(school=student.school, student=student, academic_year=year).first()
    if enrollment is None and (session_class is None or not (roll_number or '').strip()):
        raise ExitError(f'Choose a class and a roll number: {student.name} has no enrollment in {year.name} yet.')

    target_class = session_class or (enrollment.session_class if enrollment else None)
    target_class_obj_id = (
        target_class.class_obj_id if target_class else (enrollment.class_obj_id if enrollment else None)
    )
    target_roll = (roll_number or '').strip() or (enrollment.roll_number if enrollment else '')
    if _roll_taken(student.school_id, year.id, target_class, target_class_obj_id, target_roll, student):
        raise ExitError(f"Roll number '{target_roll}' is already taken in that class for {year.name}.")

    with transaction.atomic():
        if enrollment is None:
            enrollment = StudentEnrollment.objects.create(
                school=student.school, student=student, academic_year=year,
                class_obj_id=target_class_obj_id, session_class=target_class,
                roll_number=target_roll, status=StudentEnrollment.Status.ACTIVE,
            )
        else:
            enrollment.is_active = True
            enrollment.status = StudentEnrollment.Status.ACTIVE
            enrollment.left_date = None
            enrollment.save(update_fields=['is_active', 'status', 'left_date', 'updated_at'])
            if session_class is not None or (roll_number or '').strip():
                move_student(
                    enrollment, session_class=session_class,
                    roll_number=(roll_number or '').strip() or None, sync_student=False,
                )

        student.status = 'ACTIVE'
        student.status_date = return_date
        student.status_reason = ''
        student.save(update_fields=['status', 'status_date', 'status_reason', 'updated_at'])
        sync_student_snapshot(student)

        brk = close_break_on_return(
            student, return_date=return_date, previous_start=left_on, reason=reason, user=user,
        )
        activate_portal_login(student)

        log_admin_action(request, 'student_readmitted', student, metadata={
            'return_date': return_date.isoformat(), 'away_since': left_on.isoformat(),
            'academic_year_id': year.id, 'session_class_id': getattr(target_class, 'id', None),
            'roll_number': target_roll, 'reason': reason,
        })
    return brk
