"""Parent and student accounts belong to the school but must not read its staff-side data.
HasSchoolAccess now refuses them unless a view opts in with allow_portal_roles (the few
endpoints the portal pages themselves call)."""
import pytest

from students.test_profile_history import pair  # noqa: F401
from students.test_timeline import ctx  # noqa: F401
from students.test_transfer_portals import parent, student_user  # noqa: F401

# Read-only endpoints that used to answer 200 for any member of the school.
STAFF_SIDE = [
    '/api/hr/staff/',
    '/api/hr/staff/dashboard_stats/',
    '/api/admissions/enquiries/',
    '/api/attendance/records/',
    '/api/attendance/records/daily_report/?date=2026-03-10',
    '/api/examinations/exams/',
    '/api/transport/dashboard/',
    '/api/library/stats/',
    '/api/hostel/dashboard/',
    '/api/tasks/ai-insights/',
    '/api/transport/assignments/',
    '/api/library/issues/',
    '/api/hostel/allocations/',
    '/api/sessions/calendar-entries/',          # only its day-status action is opened to portals
    '/api/tasks/ai-jobs/',
]

# What the portal pages and the layout call for every parent / student session.
PORTAL_USES = [
    '/api/sessions/academic-years/',
    '/api/sessions/terms/',
    '/api/sessions/calendar-entries/day-status/?date_from=2026-03-10&date_to=2026-03-10',
    '/api/notifications/my/',
    '/api/notifications/unread-count/',
]


@pytest.mark.django_db
@pytest.mark.parametrize('who', ['parent', 'student_user'])
@pytest.mark.parametrize('url', STAFF_SIDE)
def test_portal_accounts_cannot_read_staff_side_data(api, request, who, url):
    c = request.getfixturevalue(who)
    assert api.get(url, c['token'], c['SID_B']).status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize('url', STAFF_SIDE)
def test_school_admins_still_can(api, parent, url):
    resp = api.get(url, parent['tokens']['admin_b'], parent['SID_B'])
    assert resp.status_code == 200, (url, resp.content)


@pytest.mark.django_db
@pytest.mark.parametrize('who', ['parent', 'student_user'])
@pytest.mark.parametrize('url', PORTAL_USES)
def test_portal_accounts_keep_what_their_pages_need(api, request, who, url):
    c = request.getfixturevalue(who)
    # 200, or a 4xx about the query itself: what matters is that the role is not refused
    assert api.get(url, c['token'], c['SID_B']).status_code in (200, 400)


@pytest.mark.django_db
def test_ai_insights_refuse_another_schools_id(api, parent):
    other = parent['SID_A']
    resp = api.get(f'/api/tasks/ai-insights/?school_id={other}', parent['tokens']['admin_b'], parent['SID_B'])
    assert resp.status_code == 403
