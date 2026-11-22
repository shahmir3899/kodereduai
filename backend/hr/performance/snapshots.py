"""
Monthly snapshots: freeze a finished calendar month so it keeps the figures it had, even after class
and subject assignments change (assignments keep no history, see the plan's "Known limit").

A request for exactly one whole past month reads the snapshot when there is one; anything else is live.
"""

import calendar
import logging
from datetime import date

from django.db import transaction
from django.utils import timezone

from .service import compute, config_snapshot, get_config

logger = logging.getLogger(__name__)


def month_bounds(year, month):
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def previous_month(today):
    return (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)


def is_whole_month(start, end):
    return start.day == 1 and end == month_bounds(start.year, start.month)[1]


def freeze_month(school_id, year, month, cfg=None):
    """Compute the month for the whole school and store one row per teacher. Re-freezing replaces
    the month's rows (a teacher no longer on the report loses their old row). Returns the report."""
    from hr.models import TeacherPerformanceSnapshot

    cfg = cfg or get_config(school_id)
    start, end = month_bounds(year, month)
    report = compute(school_id, start, end, cfg=cfg)
    used = config_snapshot(cfg)
    with transaction.atomic():
        TeacherPerformanceSnapshot.objects.filter(
            school_id=school_id, period_start=start, period_end=end,
        ).delete()
        TeacherPerformanceSnapshot.objects.bulk_create([
            TeacherPerformanceSnapshot(
                school_id=school_id,
                staff_member_id=t['staff_id'],
                period_start=start,
                period_end=end,
                overall_score=t['overall_score'],
                rank=t['rank'],
                out_of=report['out_of'],
                breakdown=t,
                config_used=used,
            )
            for t in report['teachers']
        ])
    return report


def read_month(school_id, start, end, staff_ids=None):
    """The frozen report for a whole month, shaped like compute()'s, or None when not frozen."""
    from hr.models import TeacherPerformanceSnapshot

    if not is_whole_month(start, end):
        return None
    rows = list(
        TeacherPerformanceSnapshot.objects.filter(school_id=school_id, period_start=start, period_end=end)
        .order_by('rank', 'id')
    )
    if not rows:
        return None
    teachers = [r.breakdown for r in rows]
    teachers.sort(key=lambda t: (t.get('rank') is None, t.get('rank') or 0, t.get('name', '')))
    if staff_ids is not None:
        wanted = set(staff_ids)
        teachers = [t for t in teachers if t['staff_id'] in wanted]
    frozen_at = max(r.computed_at for r in rows)
    return {
        'period': {'start': start.isoformat(), 'end': end.isoformat(), 'counted_until': end.isoformat()},
        'out_of': rows[0].out_of,
        'config': rows[0].config_used,
        'teachers': teachers,
        'snapshot': True,
        'frozen_at': timezone.localtime(frozen_at).isoformat(),
    }


def report_for(school_id, start, end, staff_ids=None, cfg=None):
    """Snapshot for a whole frozen month, otherwise live."""
    frozen = read_month(school_id, start, end, staff_ids)
    if frozen is not None:
        return frozen
    report = compute(school_id, start, end, staff_ids=staff_ids, cfg=cfg)
    report['snapshot'] = False
    return report


def notify_teachers(school, report, cfg, month_label):
    """One in-app message per scored teacher. Only when the school lets teachers see their score."""
    from notifications.engine import NotificationEngine

    if not cfg.enabled:
        return 0
    engine = NotificationEngine(school)
    sent = 0
    users = _users_by_id([t['user_id'] for t in report['teachers'] if t.get('user_id')])
    for t in report['teachers']:
        user = users.get(t.get('user_id'))
        if not user or t['overall_score'] is None:
            continue
        band = (t.get('band') or {}).get('label', '')
        body = f"Your {month_label} performance score is {t['overall_score']:g}" + (f' ({band})' if band else '')
        if cfg.show_rank_to_teachers and t.get('rank'):
            body += f", position {t['rank']} of {report['out_of']}"
        body += '. Open My performance to see what counted and your quickest wins.'
        try:
            engine.send(
                event_type='GENERAL', channel='IN_APP', context={},
                recipient_identifier=str(user.id), recipient_type='STAFF', recipient_user=user,
                title=f'{month_label} performance report', body=body,
            )
            sent += 1
        except Exception:
            # One teacher's failed message must not stop the others or undo the frozen month.
            logger.exception('Teacher performance notification failed for user %s', user.id)
    return sent


def _users_by_id(ids):
    from django.contrib.auth import get_user_model

    return {u.id: u for u in get_user_model().objects.filter(id__in=ids)}


def freeze_previous_month_for_all(today=None, school_ids=None, notify=True):
    """The monthly job: every active school with the HR module. One school's failure is logged and
    skipped. Returns {school_id: teachers frozen}."""
    from schools.models import School

    from hr.models import TeacherPerformanceConfig

    today = today or timezone.localdate()
    year, month = previous_month(today)
    month_label = date(year, month, 1).strftime('%B %Y')
    # Unsaved defaults for a school that never opened its settings: freezing must not create a
    # config row for every school on the platform.
    configs = {c.school_id: c for c in TeacherPerformanceConfig.objects.all()}
    schools = School.objects.select_related('organization').filter(is_active=True)
    if school_ids:
        schools = schools.filter(id__in=school_ids)
    done = {}
    for school in schools:
        if not school.get_enabled_module('hr'):
            continue
        try:
            cfg = configs.get(school.id) or TeacherPerformanceConfig(school_id=school.id)
            report = freeze_month(school.id, year, month, cfg=cfg)
            if report['teachers']:
                done[school.id] = len(report['teachers'])
                # cfg.enabled is "teachers can see their own score": admins keep the frozen month
                # either way, teachers are only told when they can open it.
                if notify:
                    notify_teachers(school, report, cfg, month_label)
        except Exception:
            logger.exception('Teacher performance freeze failed for school %s', school.id)
    return done
