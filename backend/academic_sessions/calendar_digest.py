"""
Weekly calendar summary for school admins: how attendance went this week, what in the calendar setup is
overdue, and what is coming next week. One in-app notification per admin, once a week.

No Celery and no scheduler. A school's digest falls due at 14:00 on the last working day of its week (the
latest Monday-Saturday date that is not a student-affecting OFF day), and is generated the first time an
admin opens the dashboard after that (see ``maybe_send_weekly_digest``, called from the dashboard bootstrap).
That loses nothing for an in-app message: it is waiting for them either way. The same function backs the
"send now" button on the Notifications page and the ``send_calendar_digest`` management command, which can
also be run from any external cron.

Per-person opt-out comes from the notification engine: a user who switched off General announcements (or a
school with in-app notifications off) is skipped by ``NotificationEngine.send``.
"""
import logging
import threading
from datetime import datetime, time, timedelta

from django.core.cache import cache
from django.utils import timezone

from .calendar_rules import build_student_off_day_set
from .models import AcademicYear, SchoolCalendarEntry

logger = logging.getLogger(__name__)

TITLE = 'Weekly calendar summary'
DUE_TIME = time(14, 0)
CHECK_EVERY_SECONDS = 600  # one due-check per school per 10 minutes, however often admins load the dashboard
LOCK_SECONDS = 8 * 24 * 60 * 60
MAX_NEXT_WEEK_ITEMS = 5


def _fmt(day):
    return day.strftime('%a %d %b')


def _span(start, end):
    return _fmt(start) if start == end else f'{_fmt(start)} - {_fmt(end)}'


def last_working_day(school_id, week_monday):
    """Latest Monday-Saturday date of the week that is not a student-affecting OFF day, or None."""
    off = build_student_off_day_set(school_id, week_monday, week_monday + timedelta(days=6))
    days = [week_monday + timedelta(days=n) for n in range(6)]
    working = [d for d in days if d not in off]
    return working[-1] if working else None


def _due_at(day):
    return timezone.make_aware(datetime.combine(day, DUE_TIME))


def due_week(school_id, now=None):
    """(week_monday, last_working_day) of the latest week whose digest time has passed, looking back one week."""
    now = now or timezone.localtime()
    monday = now.date() - timedelta(days=now.date().weekday())
    for week_monday in (monday, monday - timedelta(days=7)):
        last = last_working_day(school_id, week_monday)
        if last and _due_at(last) <= now:
            return week_monday, last
    return None


def _already_sent(school, week_monday):
    from notifications.models import NotificationLog

    return NotificationLog.objects.filter(
        school=school, event_type='GENERAL', title=TITLE,
        created_at__gte=timezone.make_aware(datetime.combine(week_monday, time.min)),
    ).exists()


def _attendance_line(school_id, academic_year, week_monday, last_day):
    from .coverage_service import attendance_coverage

    result = attendance_coverage(school_id, academic_year)
    week_end = week_monday + timedelta(days=6)
    week = [d for d in result['days'] if week_monday <= d['date'] <= week_end]
    finished = [d for d in week if d['state'] in ('recorded', 'partial', 'missed')]
    if not finished:
        return None

    recorded = [d for d in finished if d['state'] == 'recorded']
    gaps = [d for d in finished if d['state'] != 'recorded']
    open_today = any(d['state'] == 'pending' for d in week)
    streak = result['streak']['current']

    if not gaps and all(d['on_time'] for d in finished):
        line = f'Attendance was recorded on every working day this week ({len(finished)} of {len(finished)}), on time.'
        if streak > 1:
            line += f' Streak: {streak} days.'
    elif not gaps:
        line = f'Attendance was recorded on all {len(finished)} working days this week, though not always on the day itself.'
    else:
        line = (
            f'Attendance was recorded on {len(recorded)} of {len(finished)} working days. '
            f'Not fully recorded: {", ".join(_fmt(d["date"]) for d in gaps)}.'
        )
    if open_today:
        line += " Today's attendance is still open."
    return line


def _planning_line(school_id, academic_year):
    from .planning_service import planning_checklist

    plan = planning_checklist(school_id, academic_year)
    overdue = [i['label'] for i in plan['items'] if i['status'] == 'overdue']
    if not overdue:
        return None
    return f'Calendar setup is {plan["percent"]}% done. Overdue: {"; ".join(overdue)}.'


def _next_week_line(school_id, academic_year, week_monday):
    start = week_monday + timedelta(days=7)
    end = start + timedelta(days=6)
    items = []

    for entry in SchoolCalendarEntry.objects.filter(
        school_id=school_id, academic_year=academic_year, is_active=True,
        entry_kind=SchoolCalendarEntry.EntryKind.OFF_DAY, affects_students=True,
        start_date__lte=end, end_date__gte=start,
    ).order_by('start_date'):
        items.append((entry.start_date, f'{entry.name} ({_span(max(entry.start_date, start), min(entry.end_date, end))})'))

    from .planning_service import _module_on
    if _module_on(school_id, 'examinations'):
        from examinations.models import ExamGroup

        for group in ExamGroup.objects.filter(
            school_id=school_id, academic_year=academic_year, is_active=True,
            start_date__isnull=False, end_date__isnull=False,
            start_date__lte=end, end_date__gte=start,
        ).order_by('start_date'):
            items.append((group.start_date, f'{group.name} exams ({_span(max(group.start_date, start), min(group.end_date, end))})'))

    if not items:
        return None
    items.sort(key=lambda pair: pair[0])
    labels = [label for _, label in items]
    extra = len(labels) - MAX_NEXT_WEEK_ITEMS
    shown = labels[:MAX_NEXT_WEEK_ITEMS]
    return 'Next week: ' + '; '.join(shown) + (f' and {extra} more.' if extra > 0 else '.')


def build_digest(school, week_monday, last_day):
    """The message body for one week, or None when the school has nothing to report."""
    academic_year = AcademicYear.objects.filter(school=school, is_current=True).first()
    if not academic_year or not (academic_year.start_date <= last_day <= academic_year.end_date):
        return None
    lines = [
        _attendance_line(school.id, academic_year, week_monday, last_day),
        _planning_line(school.id, academic_year),
        _next_week_line(school.id, academic_year, week_monday),
    ]
    lines = [line for line in lines if line]
    return '\n'.join(lines) if lines else None


def send_weekly_calendar_digest(school, force=False, now=None):
    """Send this school's digest if it is due and not yet sent. ``force`` sends the current week's now.
    Returns the number of admins notified."""
    from notifications.engine import NotificationEngine
    from notifications.recipients import get_admin_users

    now = now or timezone.localtime()
    if force:
        monday = now.date() - timedelta(days=now.date().weekday())
        week_monday, last_day = monday, last_working_day(school.id, monday)
        if not last_day:
            return 0
    else:
        due = due_week(school.id, now)
        if not due:
            return 0
        week_monday, last_day = due
        if _already_sent(school, week_monday):
            return 0
        # Two admins opening the dashboard together must not both send it.
        if not cache.add(f'calendar_digest:{school.id}:{week_monday}', 1, LOCK_SECONDS):
            return 0

    try:
        body = build_digest(school, week_monday, last_day)
        if not body:
            return 0
        engine = NotificationEngine(school)
        sent = 0
        for admin in get_admin_users(school):
            log = engine.send(
                event_type='GENERAL', channel='IN_APP', context={},
                recipient_identifier=str(admin.id), recipient_type='ADMIN', recipient_user=admin,
                title=TITLE, body=body,
            )
            if log:
                sent += 1
        return sent
    except Exception:
        if not force:
            cache.delete(f'calendar_digest:{school.id}:{week_monday}')  # let the next visit retry
        raise


def maybe_send_weekly_digest(school_id):
    """Cheap hook for the admin dashboard: at most one due-check per school per 10 minutes, and the work
    itself runs on a background thread so the dashboard never waits for it."""
    if not cache.add(f'calendar_digest:checked:{school_id}', 1, CHECK_EVERY_SECONDS):
        return

    def run():
        from django.db import close_old_connections

        try:
            from schools.models import School

            school = School.objects.filter(id=school_id, is_active=True).first()
            if school:
                send_weekly_calendar_digest(school)
        except Exception:  # noqa: BLE001 - a failed digest must never affect the dashboard
            logger.warning('Weekly calendar digest failed for school %s', school_id, exc_info=True)
        finally:
            close_old_connections()

    threading.Thread(target=run, daemon=True).start()
