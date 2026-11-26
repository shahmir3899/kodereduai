"""
GET /api/bootstrap/teacher-dashboard/ — the teacher Home in one request.

The phone's teacher Home used to open about ten requests (more with several sections: two per
section for the attendance progress). Over a mobile connection each one is a round trip, so
the Home was slow to fill. This view answers all of them at once.

Each section is the exact response of the endpoint the phone used to call, produced by calling
that view in-process as the same user. That keeps permissions, tenant scoping, module gating and
the response shape identical, so the phone runs its usual parsing on it. A section that is not
200 comes back as null and the phone falls back to fetching it on its own.

The teacher performance card is deliberately not here: it builds a whole-school report to rank
the teacher, and folding it in would make every other section wait for it.
"""

from django.urls import resolve
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from core.mixins import ensure_tenant_school_id
from core.permissions import HasSchoolAccess

SECTIONS = (
    'timetable', 'class_assignments', 'section_progress', 'off_day', 'pending_submissions',
    'students_at_risk', 'exams', 'week_plans', 'notifications',
)

_factory = APIRequestFactory()


def _internal_get(request, school_id, path, params):
    """Run GET `path` as the caller; return its data on 200, else None."""
    # Same host and scheme as the real request: the factory's default host ("testserver") is not in
    # ALLOWED_HOSTS, and any list with a next page builds an absolute link from it (DisallowedHost).
    sub = _factory.get(path, {k: v for k, v in params.items() if v not in (None, '')},
                       HTTP_X_SCHOOL_ID=str(school_id), HTTP_HOST=request.get_host(), secure=request.is_secure())
    force_authenticate(sub, user=request.user, token=request.auth)
    try:
        match = resolve(path)
        response = match.func(sub, *match.args, **match.kwargs)
    except Exception:  # noqa: BLE001 - one broken section must not blank the whole Home
        return None
    return response.data if getattr(response, 'status_code', None) == 200 else None


def _count_of(data):
    """Same rule as countOf() on the phone: `count`, else the length of the list."""
    if data is None:
        return None
    if isinstance(data, dict):
        if isinstance(data.get('count'), int):
            return data['count']
        data = data.get('results', data)
    return len(data) if isinstance(data, list) else None


def _list_of(data):
    if isinstance(data, dict):
        data = data.get('results')
    return data if isinstance(data, list) else []


class TeacherDashboardBootstrapView(APIView):
    """
    Query params (all sent by the phone so the answer matches its cache keys):
      sections        comma-separated subset of SECTIONS (default: all)
      academic_year   int id (optional)
      date            YYYY-MM-DD, the school's today (attendance progress and off day)
      week_from, week_to   YYYY-MM-DD, this week's lesson plans
      notifications_limit  int (default 5)
    """

    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=400)

        q = request.query_params
        requested = {s.strip() for s in q.get('sections', ','.join(SECTIONS)).split(',')} & set(SECTIONS)
        year = q.get('academic_year') or None
        day = q.get('date') or None
        ay = {'academic_year': year}

        def get(path, params):
            return _internal_get(request, school_id, path, params)

        result = {}
        if 'timetable' in requested:
            result['timetable'] = get('/api/academics/timetable-entries/my_timetable/', ay)

        assignments = None
        if requested & {'class_assignments', 'section_progress', 'students_at_risk'}:
            assignments = get('/api/academics/class-teachers/my_classes/', ay)
            if 'class_assignments' in requested:
                result['class_assignments'] = assignments

        if 'section_progress' in requested:
            if assignments is None or not day:
                result['section_progress'] = None
            else:
                rows = []
                for a in _list_of(assignments):
                    # Same filter as sectionParams() on the phone: by section when there is one,
                    # so 5-A and 5-B never blend into one number.
                    scope = ({'session_class_id': a.get('session_class')} if a.get('session_class')
                             else {'class_id': a.get('class_obj')})
                    scope.update(ay)
                    enrol = get('/api/sessions/enrollments/', {**scope, 'active_on': day, 'page_size': 1})
                    records = get('/api/attendance/records/', {**scope, 'date': day, 'page_size': 1})
                    failed = enrol is None or records is None
                    rows.append({
                        'assignment_id': a.get('id'),
                        'total': None if failed else _count_of(enrol),
                        'marked': None if failed else _count_of(records),
                        'failed': failed,
                    })
                result['section_progress'] = rows

        if 'off_day' in requested:
            result['off_day'] = get('/api/sessions/calendar-entries/day-status/',
                                    {'date_from': day, 'date_to': day}) if day else None

        if 'pending_submissions' in requested:
            result['pending_submissions'] = get('/api/lms/submissions/', {'status': 'SUBMITTED', 'page_size': 10})

        if 'students_at_risk' in requested:
            # The phone only asks when the teacher has a class; an empty list means nothing to ask.
            result['students_at_risk'] = (
                get('/api/academics/class-teachers/my_students_at_risk/', {**ay, 'limit': 5})
                if _list_of(assignments) else None
            )

        if 'exams' in requested:
            result['exams'] = get('/api/examinations/exams/', {**ay, 'page_size': 10})

        if 'week_plans' in requested:
            result['week_plans'] = get('/api/lms/lesson-plans/', {
                'date_from': q.get('week_from'), 'date_to': q.get('week_to'), 'page_size': 30,
            })

        if 'notifications' in requested:
            result['notifications'] = get('/api/notifications/my/', {'page_size': q.get('notifications_limit') or 5})

        return Response(result)
