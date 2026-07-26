from datetime import date, timedelta

import pytest

from lms.models import LessonPlan


@pytest.fixture
def three_dated_plans(seed_data, school, class_obj, subject):
    """One plan each on yesterday / today / tomorrow (relative to `today`)."""
    teacher = seed_data['staff'][0]
    today = date.today()

    def make(lesson_date, title):
        return LessonPlan.objects.create(
            school=school,
            academic_year=seed_data['academic_year'],
            class_obj=class_obj,
            subject=subject,
            teacher=teacher,
            title=title,
            lesson_date=lesson_date,
            duration_minutes=40,
            status=LessonPlan.Status.DRAFT,
        )

    return {
        'yesterday': make(today - timedelta(days=1), 'Yesterday plan'),
        'today': make(today, 'Today plan'),
        'tomorrow': make(today + timedelta(days=1), 'Tomorrow plan'),
    }


@pytest.mark.django_db
class TestLessonPlanListDateFilter:
    def _list(self, auth_client, class_obj, subject, **params):
        resp = auth_client.get(
            '/api/lms/lesson-plans/',
            {'class_id': class_obj.id, 'subject_id': subject.id, 'page_size': 9999, **params},
        )
        assert resp.status_code == 200, resp.data
        return {p['title'] for p in resp.data['results']}

    def test_no_date_params_returns_all(self, auth_client, class_obj, subject, three_dated_plans):
        titles = self._list(auth_client, class_obj, subject)
        assert titles == {'Yesterday plan', 'Today plan', 'Tomorrow plan'}

    def test_date_from_and_date_to_narrows_to_range(self, auth_client, class_obj, subject, three_dated_plans):
        today = date.today().isoformat()
        titles = self._list(auth_client, class_obj, subject, date_from=today, date_to=today)
        assert titles == {'Today plan'}

    def test_date_from_alone_is_inclusive_lower_bound(self, auth_client, class_obj, subject, three_dated_plans):
        today = date.today().isoformat()
        titles = self._list(auth_client, class_obj, subject, date_from=today)
        assert titles == {'Today plan', 'Tomorrow plan'}

    def test_date_to_alone_is_inclusive_upper_bound(self, auth_client, class_obj, subject, three_dated_plans):
        today = date.today().isoformat()
        titles = self._list(auth_client, class_obj, subject, date_to=today)
        assert titles == {'Yesterday plan', 'Today plan'}
