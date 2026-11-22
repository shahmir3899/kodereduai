"""
compute(school_id, start, end) -> the ranked report for one school and date range.

Ranks are always worked out across the whole school, so a request for one teacher (staff_ids) still
gets that teacher's true position.
"""

from django.db.models import Exists, OuterRef

from core.school_time import school_now, school_tzinfo

from . import metrics
from .explain import quickest_wins
from .info import compute_info
from .periods import load_approved_leave, load_calendar
from .scoring import band_for, rank, score_teacher


def get_config(school_id):
    from hr.models import TeacherPerformanceConfig

    cfg, _ = TeacherPerformanceConfig.objects.get_or_create(school_id=school_id)
    return cfg


def config_snapshot(cfg):
    """The settings a result was computed with (stored with Phase 3 snapshots, shown in the API)."""
    return {
        'weights': cfg.weights,
        'attendance_cutoff_time': cfg.attendance_cutoff_time.strftime('%H:%M'),
        'marks_deadline_days': cfg.marks_deadline_days,
        'grading_deadline_days': cfg.grading_deadline_days,
        'message_reply_hours': cfg.message_reply_hours,
        'homework_per_week': cfg.homework_per_week,
        'papers_per_month': cfg.papers_per_month,
        'content_blocks_per_month': cfg.content_blocks_per_month,
        'bands': cfg.bands,
        'show_rank_to_teachers': cfg.show_rank_to_teachers,
        'enabled': cfg.enabled,
    }


def scored_teachers(school_id):
    """Teaching staff with a login and an active membership in this school. One query."""
    from hr.models import StaffMember
    from schools.models import UserSchoolMembership

    member = UserSchoolMembership.objects.filter(user_id=OuterRef('user_id'), school_id=school_id, is_active=True)
    return {
        row['id']: {
            'user_id': row['user_id'],
            'name': f"{row['first_name']} {row['last_name']}".strip(),
            'employee_id': row['employee_id'],
            'joined': row['date_of_joining'],
        }
        for row in StaffMember.objects.filter(
            school_id=school_id, is_teaching=True, is_active=True,
            employment_status__in=[StaffMember.EmploymentStatus.ACTIVE, StaffMember.EmploymentStatus.ON_LEAVE],
            user__isnull=False,
        ).filter(Exists(member)).values('id', 'user_id', 'first_name', 'last_name', 'employee_id', 'date_of_joining')
    }


def build_context(school_id, start, end, cfg=None):
    from academic_sessions.models import AcademicYear

    cfg = cfg or get_config(school_id)
    teachers = scored_teachers(school_id)
    return metrics.Context(
        school_id=school_id,
        start=start,
        end=end,
        now=school_now(school_id),
        tz=school_tzinfo(school_id),
        cfg=cfg,
        teachers=teachers,
        year_ids=list(
            AcademicYear.objects.filter(school_id=school_id, start_date__lte=end, end_date__gte=start)
            .values_list('id', flat=True)
        ),
        calendar=load_calendar(school_id, start, end),
        leave=load_approved_leave(school_id, start, end, list(teachers)),
    )


def compute(school_id, start, end, staff_ids=None, cfg=None):
    cfg = cfg or get_config(school_id)
    ctx = build_context(school_id, start, end, cfg)

    per_measure = {}
    info = {}
    if ctx.teachers:
        for key, fn in metrics.MEASURES.items():
            per_measure[key] = fn(ctx)
        info = compute_info(ctx)

    results = []
    for staff_id, t in ctx.teachers.items():
        overall, measures = score_teacher(
            {key: rows.get(staff_id) for key, rows in per_measure.items()}, cfg.weights or {},
        )
        results.append({
            'staff_id': staff_id,
            'user_id': t['user_id'],
            'name': t['name'],
            'employee_id': t['employee_id'],
            'overall_score': overall,
            'band': band_for(overall, cfg.bands),
            'measures': measures,
            'quickest_wins': quickest_wins(measures),
            # For information only; never part of the score.
            'info': info.get(staff_id, {}),
        })
    out_of = rank(results)
    results.sort(key=lambda r: (r['rank'] is None, r['rank'] or 0, r['name']))
    if staff_ids is not None:
        wanted = set(staff_ids)
        results = [r for r in results if r['staff_id'] in wanted]

    return {
        'period': {'start': start.isoformat(), 'end': end.isoformat(), 'counted_until': ctx.eff_end.isoformat()},
        'out_of': out_of,
        'config': config_snapshot(cfg),
        'teachers': results,
    }
