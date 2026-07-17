from datetime import date

import pytest

from lms.models import LessonPlan


@pytest.fixture
def second_lesson_plan(seed_data, school, class_obj, subject, topic):
    teacher = seed_data['staff'][0]
    plan = LessonPlan.objects.create(
        school=school,
        academic_year=seed_data['academic_year'],
        class_obj=class_obj,
        subject=subject,
        teacher=teacher,
        title='Second Lesson Plan',
        description='Another plan for bulk action tests',
        lesson_date=date.today(),
        duration_minutes=40,
        status=LessonPlan.Status.PUBLISHED,
    )
    plan.planned_topics.add(topic)
    return plan


@pytest.mark.django_db
class TestBulkDelete:
    def test_deletes_only_requested_ids(self, auth_client, lesson_plan, second_lesson_plan):
        resp = auth_client.post(
            '/api/lms/lesson-plans/bulk_delete/',
            {'ids': [lesson_plan.id]},
            format='json',
        )
        assert resp.status_code == 200
        assert resp.data == {'requested_count': 1, 'deleted_count': 1}
        assert not LessonPlan.objects.filter(id=lesson_plan.id).exists()
        assert LessonPlan.objects.filter(id=second_lesson_plan.id).exists()

    def test_rejects_empty_ids(self, auth_client):
        resp = auth_client.post('/api/lms/lesson-plans/bulk_delete/', {'ids': []}, format='json')
        assert resp.status_code == 400

    def test_ignores_ids_outside_tenant_scope(self, auth_client, lesson_plan):
        resp = auth_client.post(
            '/api/lms/lesson-plans/bulk_delete/',
            {'ids': [lesson_plan.id, 999999]},
            format='json',
        )
        assert resp.status_code == 200
        assert resp.data['deleted_count'] == 1


@pytest.mark.django_db
class TestBulkPublish:
    def test_publishes_only_draft_plans(self, auth_client, lesson_plan, second_lesson_plan):
        resp = auth_client.post(
            '/api/lms/lesson-plans/bulk_publish/',
            {'ids': [lesson_plan.id, second_lesson_plan.id]},
            format='json',
        )
        assert resp.status_code == 200
        assert resp.data == {'requested_count': 2, 'published_count': 1}

        lesson_plan.refresh_from_db()
        assert lesson_plan.status == LessonPlan.Status.PUBLISHED

    def test_rejects_empty_ids(self, auth_client):
        resp = auth_client.post('/api/lms/lesson-plans/bulk_publish/', {'ids': []}, format='json')
        assert resp.status_code == 400
