"""
Leadership academic insights — bootstrap endpoint and aggregation logic.
"""

import pytest
from datetime import date, datetime, timedelta

from django.utils import timezone

from core.leadership_insights_views import build_leadership_academic_insights

pytestmark = pytest.mark.django_db


@pytest.fixture
def all_modules_on():
    """Match typical school with lms + examinations enabled."""
    return {'lms': True, 'examinations': True, 'students': True}


class TestLeadershipAcademicInsightsHTTP:
    """GET /api/bootstrap/leadership-academic-insights/"""

    def test_admin_ok(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        resp = api.get(
            '/api/bootstrap/leadership-academic-insights/',
            token,
            sid,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert 'meta' in body
        assert 'admissions' in body
        assert 'rolling_30d' in body['admissions']
        assert 'lesson_plans' in body

    def test_principal_ok(self, seed_data, api):
        token = seed_data['tokens']['principal']
        sid = seed_data['SID_A']
        resp = api.get('/api/bootstrap/leadership-academic-insights/', token, sid)
        assert resp.status_code == 200

    def test_teacher_forbidden(self, seed_data, api):
        token = seed_data['tokens']['teacher']
        sid = seed_data['SID_A']
        resp = api.get('/api/bootstrap/leadership-academic-insights/', token, sid)
        assert resp.status_code == 403

    def test_academic_year_param_invalid(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        resp = api.get(
            '/api/bootstrap/leadership-academic-insights/?academic_year=999999',
            token,
            sid,
        )
        assert resp.status_code == 400


class TestBuildLeadershipAdmissionCounts:
    """LEAD-RULES-01/02 — Student.created_at + enrollment session tie."""

    def test_session_requires_enrollment_for_year(
        self, seed_data, all_modules_on,
    ):
        from students.models import Student
        from academic_sessions.models import StudentEnrollment

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        klass = seed_data['classes'][0]

        # Student created mid-session but enrollment only tied after manual fix:
        # no enrollment → not counted for session admits
        s = Student.objects.create(
            school=school,
            class_obj=klass,
            roll_number='99',
            name='Lonely Admit',
            is_active=True,
        )
        span = ay.end_date - ay.start_date
        mid_date = ay.start_date + span // 2

        Student.objects.filter(pk=s.pk).update(
            created_at=timezone.make_aware(
                datetime.combine(mid_date, datetime.min.time()),
            ),
        )

        out = build_leadership_academic_insights(
            school_id=school.id,
            academic_year=ay,
            reference_date=ay.end_date,
            enabled_modules=all_modules_on,
        )
        assert out['admissions']['session']['count'] == 0

        StudentEnrollment.objects.create(
            school=school,
            student=s,
            academic_year=ay,
            class_obj=klass,
            roll_number='99',
            status=StudentEnrollment.Status.ACTIVE,
        )

        out2 = build_leadership_academic_insights(
            school_id=school.id,
            academic_year=ay,
            reference_date=ay.end_date,
            enabled_modules=all_modules_on,
        )
        assert out2['admissions']['session']['count'] >= 1


class TestBuildLeadershipRollingAdmissions:
    def test_rolling_windows(self, seed_data, all_modules_on):
        from students.models import Student

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        klass = seed_data['classes'][0]
        ref = date.today()

        s_new = Student.objects.create(
            school=school,
            class_obj=klass,
            roll_number='Rolling1',
            name='Rolling New',
            is_active=True,
        )
        Student.objects.filter(pk=s_new.pk).update(
            created_at=timezone.now() - timedelta(days=5),
        )

        out = build_leadership_academic_insights(
            school_id=school.id,
            academic_year=ay,
            reference_date=ref,
            enabled_modules=all_modules_on,
        )
        assert out['admissions']['rolling_30d']['count'] >= 1
        assert out['admissions']['rolling_90d']['count'] >= 1

        old = Student.objects.create(
            school=school,
            class_obj=klass,
            roll_number='Old1',
            name='Too Old Rolling',
            is_active=True,
        )
        Student.objects.filter(pk=old.pk).update(
            created_at=timezone.now() - timedelta(days=120),
        )

        out2 = build_leadership_academic_insights(
            school_id=school.id,
            academic_year=ay,
            reference_date=ref,
            enabled_modules=all_modules_on,
        )
        assert out2['admissions']['rolling_30d']['count'] >= 1
        # 120 days ago outside 90d rolling
        ninety = out2['admissions']['rolling_90d']['count']
        thirty = out2['admissions']['rolling_30d']['count']
        assert ninety >= thirty


class TestBuildLeadershipDepartures:
    """LEAD-RULES-03 — enrollments leaving statuses."""

    def test_only_leaving_statuses(self, seed_data, all_modules_on):
        from students.models import Student
        from academic_sessions.models import StudentEnrollment

        school = seed_data['school_a']
        ay = seed_data['academic_year']
        klass = seed_data['classes'][0]

        s = Student.objects.create(
            school=school,
            class_obj=klass,
            roll_number='Depart1',
            name='Leaving Student',
            is_active=True,
        )
        enr = StudentEnrollment.objects.create(
            school=school,
            student=s,
            academic_year=ay,
            class_obj=klass,
            roll_number='Depart1',
            status=StudentEnrollment.Status.ACTIVE,
        )

        ref = date.today()
        out0 = build_leadership_academic_insights(
            school_id=school.id,
            academic_year=ay,
            reference_date=ref,
            enabled_modules=all_modules_on,
        )
        base_total = out0['departures']['rolling_30d']['total']

        enr.status = StudentEnrollment.Status.WITHDRAWN
        enr.save()

        out1 = build_leadership_academic_insights(
            school_id=school.id,
            academic_year=ay,
            reference_date=ref,
            enabled_modules=all_modules_on,
        )
        assert out1['departures']['rolling_30d']['total'] >= base_total + 1
        assert (
            out1['departures']['rolling_30d']['by_status'].get('WITHDRAWN', 0) >= 1
        )


class TestLmsExcludedWhenDisabled:
    def test_empty_lms_when_module_off(self, seed_data):
        enabled = {'lms': False, 'examinations': False}
        school = seed_data['school_a']
        ay = seed_data['academic_year']
        out = build_leadership_academic_insights(
            school_id=school.id,
            academic_year=ay,
            reference_date=date.today(),
            enabled_modules=enabled,
        )
        assert out['lms_books_by_class'] == []
        assert out['lms_topics_by_book'] == []
        assert out['question_bank']['total'] == 0
        assert out['lesson_plans']['by_teacher_class'] == []
