from datetime import date

import pytest

from lms.models import LessonPlan


@pytest.mark.django_db
class TestComputeDisplayTextWithCustomTopics:
    def test_merges_custom_topics_after_fk_topics(self, lesson_plan, topic):
        lesson_plan.custom_topics = ['Revision: fractions']
        lesson_plan.save(update_fields=['custom_topics'])

        text = lesson_plan.compute_display_text()

        assert f"{topic.chapter.chapter_number}.{topic.topic_number} {topic.title}" in text
        assert 'Custom topics' in text
        assert '· Revision: fractions' in text
        assert text.index('Custom topics') > text.index(topic.title)

    def test_custom_topics_alone_produce_display_text(self, seed_data, school, class_obj, subject):
        plan = LessonPlan.objects.create(
            school=school,
            academic_year=seed_data['academic_year'],
            class_obj=class_obj,
            subject=subject,
            teacher=seed_data['staff'][0],
            title='Freeform plan',
            description='No book topics linked',
            lesson_date=date.today(),
            duration_minutes=40,
            content_mode='FREEFORM',
            custom_topics=['Introduction to recycling'],
        )

        text = plan.compute_display_text()

        assert text == '  · Introduction to recycling'

    def test_blank_everything_returns_empty_string(self, seed_data, school, class_obj, subject):
        plan = LessonPlan.objects.create(
            school=school,
            academic_year=seed_data['academic_year'],
            class_obj=class_obj,
            subject=subject,
            teacher=seed_data['staff'][0],
            title='Empty plan',
            description='',
            lesson_date=date.today(),
            duration_minutes=40,
        )

        assert plan.compute_display_text() == ''


@pytest.mark.django_db
class TestLessonPlanCreateSerializerCustomTopics:
    def _payload(self, seed_data, school, class_obj, subject, **overrides):
        payload = {
            'school': school.id,
            'academic_year': seed_data['academic_year'].id,
            'class_obj': class_obj.id,
            'subject': subject.id,
            'teacher': seed_data['staff'][0].id,
            'title': 'Custom topics plan',
            'description': 'desc',
            'lesson_date': date.today().isoformat(),
            'duration_minutes': 40,
            'content_mode': 'FREEFORM',
            'status': 'DRAFT',
        }
        payload.update(overrides)
        return payload

    def test_create_persists_custom_topics_without_requiring_fk_topics(
        self, auth_client, seed_data, school, class_obj, subject,
    ):
        payload = self._payload(
            seed_data, school, class_obj, subject,
            custom_topics=['Guest speaker session', '  '],
        )
        resp = auth_client.post('/api/lms/lesson-plans/', payload, format='json')

        assert resp.status_code == 201, resp.data
        plan = LessonPlan.objects.get(id=resp.data['id'])
        assert plan.custom_topics == ['Guest speaker session']
        assert plan.content_mode == 'FREEFORM'
        assert '· Guest speaker session' in plan.display_text

    def test_create_mixes_custom_topics_with_fk_topics(
        self, auth_client, seed_data, school, class_obj, subject, topic,
    ):
        payload = self._payload(
            seed_data, school, class_obj, subject,
            planned_topic_ids=[topic.id],
            custom_topics=['Extra worksheet review'],
        )
        resp = auth_client.post('/api/lms/lesson-plans/', payload, format='json')

        assert resp.status_code == 201, resp.data
        plan = LessonPlan.objects.get(id=resp.data['id'])
        assert plan.content_mode == 'TOPICS'
        assert topic in plan.planned_topics.all()
        assert plan.custom_topics == ['Extra worksheet review']
        assert 'Custom topics' in plan.display_text
        assert '· Extra worksheet review' in plan.display_text

    def test_update_recomputes_display_text_when_only_custom_topics_change(
        self, auth_client, lesson_plan,
    ):
        resp = auth_client.patch(
            f'/api/lms/lesson-plans/{lesson_plan.id}/',
            {'custom_topics': ['Added later']},
            format='json',
        )

        assert resp.status_code == 200, resp.data
        lesson_plan.refresh_from_db()
        assert lesson_plan.custom_topics == ['Added later']
        assert '· Added later' in lesson_plan.display_text
