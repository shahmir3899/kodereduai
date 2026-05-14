"""
Leadership academic insights — aggregates for SCHOOL_ADMIN / PRINCIPAL dashboards.

Uses Student.created_at for new admissions (all creation paths).
Uses StudentEnrollment for departures (WITHDRAWN, TRANSFERRED, GRADUATED);
updated_at is the interim effective date filter (see docs/LEADERSHIP_INSIGHTS_ENGINEERING_TICKETS.md).

Date semantics: compares ORM __date lookups in the server's default timezone unless USE_TZ
dictates otherwise — consistent with other dashboard endpoints using date.today().
"""

from calendar import monthrange
from datetime import date, timedelta

from django.db.models import Count
from django.utils.dateparse import parse_date
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import ensure_tenant_school_id
from core.permissions import HasSchoolAccess, get_effective_role

_LEAD_ROLES = {'SCHOOL_ADMIN', 'PRINCIPAL'}
_LEAVING_ENROLLMENT_STATUSES = ('WITHDRAWN', 'TRANSFERRED', 'GRADUATED')


def _module_on(enabled: dict, key: str) -> bool:
    module_cfg = enabled.get(key, False)
    if isinstance(module_cfg, dict):
        return bool(module_cfg.get('enabled', False))
    if isinstance(module_cfg, bool):
        return module_cfg
    return False


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    m = month + delta
    while m < 1:
        m += 12
        year -= 1
    while m > 12:
        m -= 12
        year += 1
    return year, m


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    last = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def build_leadership_academic_insights(
    *,
    school_id: int,
    academic_year=None,
    reference_date: date | None = None,
    enabled_modules: dict | None = None,
) -> dict:
    """
    Pure aggregation logic (testable).
    academic_year may be None -> session-scoped buckets are omitted (null counts).
    """
    from examinations.models import Question
    from lms.models import Book, LessonPlan, Topic
    from academic_sessions.models import SessionClass, StudentEnrollment
    from students.models import Student

    ref = reference_date or date.today()
    enabled = enabled_modules if isinstance(enabled_modules, dict) else {}

    admissions = {}
    departures = {}

    # --- Admissions ---
    admissions['rolling_30d'] = {
        'count': Student.objects.filter(
            school_id=school_id,
            created_at__date__gte=ref - timedelta(days=30),
            created_at__date__lte=ref,
        ).count(),
    }
    admissions['rolling_90d'] = {
        'count': Student.objects.filter(
            school_id=school_id,
            created_at__date__gte=ref - timedelta(days=90),
            created_at__date__lte=ref,
        ).count(),
    }

    if academic_year:
        admissions['session'] = {
            'count': Student.objects.filter(
                school_id=school_id,
                created_at__date__gte=academic_year.start_date,
                created_at__date__lte=academic_year.end_date,
                enrollments__academic_year_id=academic_year.id,
            ).distinct().count(),
        }
        # Rolling departures: filtered to enrollments for this academic year
        for label, days in [('rolling_30d', 30), ('rolling_90d', 90)]:
            start = ref - timedelta(days=days)
            qs = StudentEnrollment.objects.filter(
                school_id=school_id,
                academic_year_id=academic_year.id,
                status__in=_LEAVING_ENROLLMENT_STATUSES,
                updated_at__date__gte=start,
                updated_at__date__lte=ref,
            )
            departures[label] = {
                'total': qs.count(),
                'by_status': dict(qs.values('status').annotate(c=Count('id')).values_list('status', 'c')),
            }
        qs_sess = StudentEnrollment.objects.filter(
            school_id=school_id,
            academic_year_id=academic_year.id,
            status__in=_LEAVING_ENROLLMENT_STATUSES,
            updated_at__date__gte=academic_year.start_date,
            updated_at__date__lte=min(academic_year.end_date, ref),
        )
        departures['session'] = {
            'total': qs_sess.count(),
            'by_status': dict(qs_sess.values('status').annotate(c=Count('id')).values_list('status', 'c')),
        }
    else:
        admissions['session'] = None
        # Rolling departures across all enrollments for the school
        for label, days in [('rolling_30d', 30), ('rolling_90d', 90)]:
            start = ref - timedelta(days=days)
            qs = StudentEnrollment.objects.filter(
                school_id=school_id,
                status__in=_LEAVING_ENROLLMENT_STATUSES,
                updated_at__date__gte=start,
                updated_at__date__lte=ref,
            )
            departures[label] = {
                'total': qs.count(),
                'by_status': dict(qs.values('status').annotate(c=Count('id')).values_list('status', 'c')),
            }
        departures['session'] = None

    # Books and lesson plans are attached to master Class rows, but schools often
    # rename classes per session (e.g. master "Nursery" → 2026-27 session
    # "Junior 1"). When a current academic year exists, prefer the SessionClass
    # label so the dashboard matches the rest of the session-aware UI.
    session_label_by_master: dict[int, str] = {}
    if academic_year:
        for sc in SessionClass.objects.filter(
            school_id=school_id,
            academic_year_id=academic_year.id,
            is_active=True,
            class_obj_id__isnull=False,
        ).values('class_obj_id', 'display_name', 'section'):
            section = (sc.get('section') or '').strip()
            display = sc.get('display_name') or ''
            label = f"{display} - {section}" if section else display
            # If multiple sessions share a master class (e.g. Class 2 A / B),
            # keep the first; the master fallback still indicates ambiguity.
            session_label_by_master.setdefault(sc['class_obj_id'], label)

    def _resolve_class_label(master_id: int | None, master_name: str | None) -> str:
        if master_id and master_id in session_label_by_master:
            return session_label_by_master[master_id]
        return master_name or ''

    # --- LMS: books / topics ---
    lms_books_by_class = []
    lms_topics_by_book = []
    if _module_on(enabled, 'lms'):
        lms_books_by_class = [
            {
                'class_id': r['class_obj_id'],
                'class_name': _resolve_class_label(r['class_obj_id'], r['class_obj__name']),
                'book_count': r['book_count'],
            }
            for r in Book.objects.filter(school_id=school_id, is_active=True)
            .values('class_obj_id', 'class_obj__name')
            .annotate(book_count=Count('id'))
            .order_by('class_obj__name')
        ]
        # Re-sort by the resolved label so chips render alphabetically by what
        # the user actually sees.
        lms_books_by_class.sort(key=lambda row: (row['class_name'] or '').lower())

        topic_rows = (
            Topic.objects.filter(
                chapter__book__school_id=school_id,
                is_active=True,
                chapter__book__is_active=True,
            )
            .values(
                'chapter__book_id',
                'chapter__book__title',
                'chapter__book__class_obj_id',
                'chapter__book__class_obj__name',
            )
            .annotate(topic_count=Count('id'))
            .order_by('chapter__book__class_obj__name', 'chapter__book__title')
        )
        lms_topics_by_book = [
            {
                'book_id': r['chapter__book_id'],
                'book_title': r['chapter__book__title'],
                'class_name': _resolve_class_label(
                    r['chapter__book__class_obj_id'],
                    r['chapter__book__class_obj__name'],
                ),
                'topic_count': r['topic_count'],
            }
            for r in topic_rows
        ]
        lms_topics_by_book.sort(
            key=lambda row: ((row['class_name'] or '').lower(), (row['book_title'] or '').lower())
        )

    question_bank = {'total': 0, 'by_subject': []}
    if _module_on(enabled, 'examinations'):
        qb = Question.objects.filter(school_id=school_id)
        question_bank['total'] = qb.count()
        question_bank['by_subject'] = [
            {'subject_id': r['subject_id'], 'subject_name': r['subject__name'], 'count': r['count']}
            for r in qb.values('subject_id', 'subject__name')
            .annotate(count=Count('id'))
            .order_by('-count', 'subject__name')
        ]

    lesson_plans_payload = {'buckets': {}, 'by_teacher_class': []}
    if _module_on(enabled, 'lms'):
        py, pm = _shift_month(ref.year, ref.month, -1)
        cy, cm = ref.year, ref.month
        ny, nm = _shift_month(ref.year, ref.month, 1)

        def _bucket_key(y: int, m: int) -> str:
            return f'{y:04d}-{m:02d}'

        buckets = {
            'previous_month': {'year': py, 'month': pm, 'label': _bucket_key(py, pm)},
            'current_month': {'year': cy, 'month': cm, 'label': _bucket_key(cy, cm)},
            'next_month': {'year': ny, 'month': nm, 'label': _bucket_key(ny, nm)},
        }

        def _agg_month(y: int, m: int) -> dict[tuple[int, int], int]:
            d0, d1 = _month_bounds(y, m)
            rows = (
                LessonPlan.objects.filter(
                    school_id=school_id,
                    is_active=True,
                    lesson_date__gte=d0,
                    lesson_date__lte=d1,
                )
                .values('teacher_id', 'class_obj_id')
                .annotate(cnt=Count('id'))
            )
            return {(r['teacher_id'], r['class_obj_id']): r['cnt'] for r in rows}

        prev_map = _agg_month(py, pm)
        cur_map = _agg_month(cy, cm)
        next_map = _agg_month(ny, nm)
        keys = set(prev_map) | set(cur_map) | set(next_map)

        teacher_ids = {k[0] for k in keys}
        class_ids = {k[1] for k in keys}
        teachers = {}
        if teacher_ids:
            from hr.models import StaffMember

            for sm in StaffMember.objects.filter(id__in=teacher_ids).only(
                'id', 'first_name', 'last_name',
            ):
                teachers[sm.id] = f'{sm.first_name or ""} {(sm.last_name or "")}'.strip() or sm.employee_id or str(sm.id)

        classes = {}
        if class_ids:
            from students.models import Class as SchoolClass

            for c in SchoolClass.objects.filter(id__in=class_ids).only('id', 'name'):
                # Prefer current-year session label when available (consistent
                # with lms_books_by_class above).
                classes[c.id] = _resolve_class_label(c.id, c.name)

        grid = []
        for tid, cid in sorted(keys, key=lambda x: (classes.get(x[1], ''), teachers.get(x[0], ''))):
            grid.append({
                'teacher_id': tid,
                'teacher_name': teachers.get(tid, str(tid)),
                'class_id': cid,
                'class_name': classes.get(cid, str(cid)),
                'previous_month': prev_map.get((tid, cid), 0),
                'current_month': cur_map.get((tid, cid), 0),
                'next_month': next_map.get((tid, cid), 0),
            })

        lesson_plans_payload = {'buckets': buckets, 'by_teacher_class': grid}

    return {
        'admissions': admissions,
        'departures': departures,
        'lms_books_by_class': lms_books_by_class,
        'lms_topics_by_book': lms_topics_by_book,
        'question_bank': question_bank,
        'lesson_plans': lesson_plans_payload,
    }


class LeadershipAcademicInsightsView(APIView):
    """
    GET /api/bootstrap/leadership-academic-insights/

    Query params:
      reference_date    YYYY-MM-DD (default: today)
      academic_year     int id — optional; when omitted uses school's current academic year if any.

    Accessible to SCHOOL_ADMIN and PRINCIPAL only.
    """

    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        role = get_effective_role(request)
        if role not in _LEAD_ROLES:
            return Response({'detail': 'Forbidden.'}, status=403)

        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        ref_param = request.query_params.get('reference_date')
        ref_date = parse_date(ref_param) if ref_param else date.today()
        if not ref_date:
            return Response({'detail': 'Invalid reference_date. Use YYYY-MM-DD.'}, status=400)

        from academic_sessions.models import AcademicYear
        from schools.models import School

        academic_year_param = request.query_params.get('academic_year')

        ay = None
        if academic_year_param:
            ay = AcademicYear.objects.filter(id=academic_year_param, school_id=school_id).first()
            if not ay:
                return Response({'detail': 'Academic year not found for this school.'}, status=400)
        else:
            ay = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()

        try:
            school = School.objects.only('enabled_modules').get(id=school_id)
            enabled = school.enabled_modules or {}
        except School.DoesNotExist:
            enabled = {}

        if not isinstance(enabled, dict):
            enabled = {}

        payload = build_leadership_academic_insights(
            school_id=school_id,
            academic_year=ay,
            reference_date=ref_date,
            enabled_modules=enabled,
        )

        meta = {
            'school_id': school_id,
            'academic_year_id': ay.id if ay else None,
            'reference_date': str(ref_date),
            'definitions': [
                'admissions.session: Student.created_date in [year start, year end] '
                'and has StudentEnrollment for that academic year.',
                'admissions.rolling_*d: Student.created_at date within trailing window.',
                'departures: StudentEnrollment statuses WITHDRAWN, TRANSFERRED, GRADUATED; '
                'filtered by enrollment.updated_at date (approximate leave date).',
            ],
        }

        return Response({'meta': meta, **payload})
