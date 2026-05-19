import pytest


@pytest.mark.django_db
class TestCurriculumStandards:
    def test_create_curriculum_standard(self):
        from lms.models import CurriculumStandard

        std = CurriculumStandard.objects.create(
            name='SNC 2021',
            country='Pakistan',
            board='Federal Board',
        )
        assert std.id is not None
        assert std.name == 'SNC 2021'

    def test_create_standard_objective(self, curriculum_standard, subject, class_obj):
        from lms.models import StandardObjective

        slo = StandardObjective.objects.create(
            standard=curriculum_standard,
            subject=subject,
            grade=class_obj,
            code='Bio-9-3.2.1',
            statement='Students can explain cell division.',
        )
        assert slo.code == 'Bio-9-3.2.1'

    def test_align_topic_to_standard_objective(self, topic, standard_objective):
        from lms.models import TopicStandardAlignment

        alignment = TopicStandardAlignment.objects.create(
            topic=topic,
            objective=standard_objective,
        )
        assert alignment.id is not None

    def test_topic_standard_alignment_unique(self, topic, standard_objective):
        from django.db import IntegrityError
        from lms.models import TopicStandardAlignment

        TopicStandardAlignment.objects.create(topic=topic, objective=standard_objective)
        with pytest.raises(IntegrityError):
            TopicStandardAlignment.objects.create(topic=topic, objective=standard_objective)

    def test_get_standards_for_topic(self, auth_client, topic_with_standards):
        response = auth_client.get(f'/api/lms/topics/{topic_with_standards.id}/standards/')
        assert response.status_code == 200
        assert len(response.data) >= 1

    def test_paper_coverage_stats_include_slo_count(self, auth_client, exam_paper_with_questions):
        response = auth_client.get(
            f'/api/examinations/exam-papers/{exam_paper_with_questions.id}/coverage_stats/'
        )
        assert response.status_code == 200
        assert 'covered_slos' in response.data or 'slo_coverage' in response.data

    def test_standard_objective_code_format(self, curriculum_standard, subject, class_obj):
        from lms.models import StandardObjective

        slo = StandardObjective.objects.create(
            standard=curriculum_standard,
            subject=subject,
            grade=class_obj,
            code='Math-10-2.1.3',
            statement='Apply quadratic formula',
        )
        assert '-' in slo.code
