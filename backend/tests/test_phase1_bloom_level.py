import pytest

from examinations.models import Question


@pytest.fixture
def bloom_subject(seed_data):
    return seed_data['subjects'][0]


@pytest.fixture
def bloom_question(seed_data, bloom_subject):
    return Question.objects.create(
        school=seed_data['school_a'],
        subject=bloom_subject,
        question_text='P1 Bloom question',
        question_type='SHORT',
        difficulty_level='MEDIUM',
        marks='2.00',
        answer_text='Expected answer',
        created_by=seed_data['users']['admin'],
        is_active=True,
    )


@pytest.mark.django_db
class TestBloomLevel:
    def test_bloom_level_field_exists_on_question(self, bloom_question):
        assert hasattr(bloom_question, 'bloom_level')

    def test_bloom_level_accepts_valid_values(self, bloom_question):
        valid = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']
        for level in valid:
            bloom_question.bloom_level = level
            bloom_question.save()
            bloom_question.refresh_from_db()
            assert bloom_question.bloom_level == level

    def test_bloom_level_nullable(self, bloom_question):
        bloom_question.bloom_level = None
        bloom_question.save()
        bloom_question.refresh_from_db()
        assert bloom_question.bloom_level is None

    def test_filter_questions_by_bloom_level(self, seed_data, api, bloom_subject):
        Question.objects.create(
            school=seed_data['school_a'],
            subject=bloom_subject,
            question_text='Bloom apply question',
            question_type='SHORT',
            difficulty_level='MEDIUM',
            bloom_level='apply',
            marks='2.00',
            answer_text='Expected answer',
            created_by=seed_data['users']['admin'],
            is_active=True,
        )
        Question.objects.create(
            school=seed_data['school_a'],
            subject=bloom_subject,
            question_text='Bloom evaluate question',
            question_type='SHORT',
            difficulty_level='MEDIUM',
            bloom_level='evaluate',
            marks='2.00',
            answer_text='Expected answer',
            created_by=seed_data['users']['admin'],
            is_active=True,
        )

        response = api.get(
            f'/api/examinations/questions/?bloom_level=apply&subject={bloom_subject.id}',
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )
        assert response.status_code == 200
        for q in response.json().get('results', []):
            assert q['bloom_level'] == 'apply'

    def test_bloom_level_in_question_serializer(self, seed_data, api, bloom_question):
        response = api.get(
            f'/api/examinations/questions/{bloom_question.id}/',
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )
        assert response.status_code == 200
        assert 'bloom_level' in response.json()
