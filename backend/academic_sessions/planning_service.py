"""
How far the academic year has been set up in advance, as a short fixed checklist.

Items (same for every school, so the percent means the same thing everywhere):
  terms      the year has terms and together they cover every day of it
  summer     a Summer Vacation OFF entry overlaps the year
  exams      one item per term: an exam group linked to the term, with dates (skipped when the
             school has the Examinations module off)

Not counted, on purpose: public holidays and the winter vacation. Winter breaks vary from school to
school and even class to class, and a holiday a school does not observe must not hold its score down.
They are returned as ``hints`` so the UI can nudge without penalising.

An item is ``overdue`` once its time has passed and it is still missing; before that it is ``pending``.
"""
from datetime import timedelta

from django.utils import timezone

from .models import SchoolCalendarEntry, Term

SUMMER_NOTICE_DAYS = 30  # the summer vacation is overdue this long before the year ends


def _module_on(school_id, key):
    from schools.models import School

    enabled = School.objects.filter(id=school_id).values_list('enabled_modules', flat=True).first()
    cfg = (enabled or {}).get(key, False) if isinstance(enabled, dict) else False
    if isinstance(cfg, dict):
        return bool(cfg.get('enabled', False))
    return bool(cfg)


def _uncovered_days(terms, start, end):
    """Days of [start, end] that no term covers."""
    covered_to = start - timedelta(days=1)
    gap = 0
    for term in sorted(terms, key=lambda t: t.start_date):
        if term.start_date > covered_to + timedelta(days=1):
            gap += (min(term.start_date, end + timedelta(days=1)) - (covered_to + timedelta(days=1))).days
        covered_to = max(covered_to, term.end_date)
    if covered_to < end:
        gap += (end - covered_to).days
    return max(gap, 0)


def _vacation_entered(school_id, academic_year, off_day_type):
    return SchoolCalendarEntry.objects.filter(
        school_id=school_id, academic_year=academic_year, is_active=True,
        entry_kind=SchoolCalendarEntry.EntryKind.OFF_DAY, off_day_type=off_day_type,
        start_date__lte=academic_year.end_date, end_date__gte=academic_year.start_date,
    ).exists()


def planning_checklist(school_id, academic_year, today=None):
    today = today or timezone.localdate()
    start, end = academic_year.start_date, academic_year.end_date

    def status(done, overdue_when):
        if done:
            return 'done'
        return 'overdue' if overdue_when else 'pending'

    items = []

    terms = list(Term.objects.filter(school_id=school_id, academic_year=academic_year, is_active=True))
    gap_days = _uncovered_days(terms, start, end) if terms else (end - start).days + 1
    terms_done = bool(terms) and gap_days == 0
    items.append({
        'key': 'terms',
        'label': 'Terms cover the whole year',
        'status': status(terms_done, today >= start),
        'detail': (
            'No terms yet' if not terms
            else f'{gap_days} day{"s" if gap_days != 1 else ""} not covered by a term' if gap_days
            else f'{len(terms)} term{"s" if len(terms) != 1 else ""}'
        ),
        'action': {'type': 'terms'},
    })

    summer_done = _vacation_entered(school_id, academic_year, SchoolCalendarEntry.OffDayType.SUMMER_VACATION)
    items.append({
        'key': 'summer',
        'label': 'Summer vacation entered',
        'status': status(summer_done, today > end - timedelta(days=SUMMER_NOTICE_DAYS)),
        'detail': 'Entered' if summer_done else 'Not entered',
        'action': {'type': 'entry', 'off_day_type': 'SUMMER_VACATION', 'name': 'Summer Vacation'},
    })

    if _module_on(school_id, 'examinations'):
        from examinations.models import ExamGroup

        with_exams = set(
            ExamGroup.objects.filter(
                school_id=school_id, academic_year=academic_year, is_active=True,
                start_date__isnull=False, end_date__isnull=False, term__isnull=False,
            ).values_list('term_id', flat=True)
        )
        for term in sorted(terms, key=lambda t: (t.order, t.start_date)):
            done = term.id in with_exams
            items.append({
                'key': f'exams-{term.id}',
                'label': f'Exam period for {term.name}',
                'status': status(done, today > term.end_date),
                'detail': 'Scheduled' if done else 'No exam group with dates',
                'action': {'type': 'exams'},
            })

    done_count = sum(1 for i in items if i['status'] == 'done')
    hints = [{
        'key': 'winter',
        'label': 'Winter vacation',
        'done': _vacation_entered(school_id, academic_year, SchoolCalendarEntry.OffDayType.WINTER_VACATION),
        'note': 'Optional: schools and classes differ, so it is not part of the score.',
        'action': {'type': 'entry', 'off_day_type': 'WINTER_VACATION', 'name': 'Winter Vacation'},
    }]

    return {
        'percent': round(done_count / len(items) * 100) if items else None,
        'done': done_count,
        'total': len(items),
        'overdue': sum(1 for i in items if i['status'] == 'overdue'),
        'items': items,
        'hints': hints,
    }
