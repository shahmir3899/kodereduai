"""Single definition of "taught" and the planned-vs-taught status for a topic.

A topic counts as taught only once a lesson plan covering it is published and
its lesson_date has arrived -- a draft, or a plan dated in the future, is
intent rather than delivered teaching. Everything that reports coverage
(Topic.is_covered, the coverage page, syllabus progress) goes through here so
the figures can't drift apart.
"""
from datetime import timedelta

from django.db.models import DateField, ExpressionWrapper, F, Min, OuterRef, Q, Subquery
from django.utils import timezone

# Days after the planned date before a topic is "late". Strict by default.
LATE_GRACE_DAYS = 0

STATUS_NOT_PLANNED = 'not_planned'
STATUS_UPCOMING = 'upcoming'
STATUS_OVERDUE = 'overdue'
STATUS_ON_TIME = 'on_time'
STATUS_LATE = 'late'
STATUS_UNSCHEDULED = 'unscheduled'  # taught, but no planned date was set

COVERAGE_STATUSES = (
    STATUS_NOT_PLANNED, STATUS_UPCOMING, STATUS_OVERDUE,
    STATUS_ON_TIME, STATUS_LATE, STATUS_UNSCHEDULED,
)


def taught_plan_q(prefix='', academic_year_id=None, today=None):
    """Q selecting LessonPlan rows that count as teaching a topic.

    `prefix` is the lookup path to LessonPlan from the queried model
    (e.g. 'lesson_plans__' from Topic, '' from LessonPlan itself).
    """
    today = today or timezone.localdate()
    q = Q(**{
        f'{prefix}is_active': True,
        f'{prefix}status': 'PUBLISHED',
        f'{prefix}lesson_date__lte': today,
    })
    if academic_year_id:
        q &= Q(**{f'{prefix}academic_year_id': academic_year_id})
    return q


def annotate_coverage(queryset, academic_year_id=None, today=None):
    """Annotate topics with `_taught_date` (and `_planned_date` for a year)."""
    from .models import TopicSchedule

    queryset = queryset.annotate(
        _taught_date=Min(
            'lesson_plans__lesson_date',
            filter=taught_plan_q('lesson_plans__', academic_year_id, today),
        ),
    )
    if academic_year_id:
        queryset = queryset.annotate(
            _planned_date=Subquery(
                TopicSchedule.objects.filter(
                    topic=OuterRef('pk'), academic_year_id=academic_year_id,
                ).values('planned_date')[:1]
            ),
        )
    return queryset


def compute_coverage_status(taught_date, planned_date, today=None):
    """Status from the topic's taught date and this year's planned date."""
    today = today or timezone.localdate()
    grace = timedelta(days=LATE_GRACE_DAYS)
    if taught_date:
        if not planned_date:
            return STATUS_UNSCHEDULED, 0
        days_late = (taught_date - planned_date).days
        if taught_date > planned_date + grace:
            return STATUS_LATE, days_late
        return STATUS_ON_TIME, 0
    if not planned_date:
        return STATUS_NOT_PLANNED, 0
    if planned_date + grace < today:
        return STATUS_OVERDUE, (today - planned_date).days
    return STATUS_UPCOMING, 0


def filter_by_coverage_status(queryset, coverage_status, today=None):
    """Filter an annotate_coverage()'d queryset (needs a year) by status."""
    today = today or timezone.localdate()
    cutoff = today - timedelta(days=LATE_GRACE_DAYS)
    taught = Q(_taught_date__isnull=False)
    not_taught = Q(_taught_date__isnull=True)
    planned = Q(_planned_date__isnull=False)
    if coverage_status == STATUS_NOT_PLANNED:
        return queryset.filter(not_taught, _planned_date__isnull=True)
    if coverage_status == STATUS_UNSCHEDULED:
        return queryset.filter(taught, _planned_date__isnull=True)
    if coverage_status == STATUS_UPCOMING:
        return queryset.filter(not_taught, planned, _planned_date__gte=cutoff)
    if coverage_status == STATUS_OVERDUE:
        return queryset.filter(not_taught, planned, _planned_date__lt=cutoff)
    if coverage_status in (STATUS_ON_TIME, STATUS_LATE):
        deadline = ExpressionWrapper(
            F('_planned_date') + timedelta(days=LATE_GRACE_DAYS),
            output_field=DateField(),
        )
        queryset = queryset.filter(taught, planned).annotate(_deadline=deadline)
        if coverage_status == STATUS_LATE:
            return queryset.filter(_taught_date__gt=F('_deadline'))
        return queryset.filter(_taught_date__lte=F('_deadline'))
    return queryset.none()
