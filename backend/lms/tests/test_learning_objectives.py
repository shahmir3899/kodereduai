import pytest


@pytest.mark.django_db
class TestLearningObjectiveModel:
    def test_create_learning_objective(self, topic):
        from lms.models import LearningObjective

        obj = LearningObjective.objects.create(
            topic=topic,
            statement='Students will be able to explain photosynthesis.',
            bloom_level='understand',
            is_ai_generated=False,
        )
        assert obj.id is not None
        assert obj.bloom_level == 'understand'

    def test_learning_objective_requires_topic(self):
        from django.db import IntegrityError
        from lms.models import LearningObjective

        with pytest.raises(IntegrityError):
            LearningObjective.objects.create(
                statement='No topic attached',
                bloom_level='apply',
            )

    def test_get_objectives_for_topic(self, auth_client, topic, learning_objectives):
        response = auth_client.get(f'/api/lms/topics/{topic.id}/objectives/')
        assert response.status_code == 200
        assert len(response.data) >= 1

    def test_link_objectives_to_lesson_plan(self, auth_client, lesson_plan, learning_objective):
        response = auth_client.post(
            f'/api/lms/lesson-plans/{lesson_plan.id}/link_objectives/',
            {'objective_ids': [learning_objective.id]},
            format='json',
        )
        assert response.status_code in [200, 201]

    def test_lesson_plan_serializer_returns_objectives(self, auth_client, lesson_plan_with_objectives):
        response = auth_client.get(f'/api/lms/lesson-plans/{lesson_plan_with_objectives.id}/')
        assert 'objectives' in response.data
        assert len(response.data['objectives']) >= 1

    def test_ai_generated_objective_flagged(self, topic):
        from lms.models import LearningObjective

        obj = LearningObjective.objects.create(
            topic=topic,
            statement='AI generated objective',
            bloom_level='create',
            is_ai_generated=True,
        )
        assert obj.is_ai_generated is True

    def test_is_active_default_true(self, topic):
        from lms.models import LearningObjective

        obj = LearningObjective.objects.create(
            topic=topic,
            statement='Active by default',
            bloom_level='remember',
        )
        assert obj.is_active is True

    def test_lesson_plan_objective_unique_constraint(self, lesson_plan, learning_objective):
        from django.db import IntegrityError
        from lms.models import LessonPlanObjective

        LessonPlanObjective.objects.create(
            lesson_plan=lesson_plan,
            objective=learning_objective,
        )
        with pytest.raises(IntegrityError):
            LessonPlanObjective.objects.create(
                lesson_plan=lesson_plan,
                objective=learning_objective,
            )
