import pytest
from django.utils import timezone

from examinations.models import Question
from lms.models import Book, Chapter, ContentBlock, Topic


@pytest.fixture
def ai_source_block(seed_data):
    book = Book.objects.create(
        school=seed_data['school_a'],
        class_obj=seed_data['classes'][0],
        subject=seed_data['subjects'][0],
        title='P1 AI Link Book',
        language='en',
    )
    chapter = Chapter.objects.create(
        book=book,
        title='P1 AI Link Chapter',
        chapter_number=1,
    )
    topic = Topic.objects.create(
        chapter=chapter,
        title='P1 AI Link Topic',
        topic_number=1,
    )
    return ContentBlock.objects.create(
        topic=topic,
        block_type='text',
        content_text='Source paragraph',
        sequence_order=1,
    )


@pytest.fixture
def question(seed_data):
    return Question.objects.create(
        school=seed_data['school_a'],
        subject=seed_data['subjects'][0],
        question_text='P1 AI fields question',
        question_type='SHORT',
        difficulty_level='MEDIUM',
        marks='2.00',
        answer_text='Expected answer',
        created_by=seed_data['users']['admin'],
        is_active=True,
    )


@pytest.fixture
def ai_question(seed_data):
    return Question.objects.create(
        school=seed_data['school_a'],
        subject=seed_data['subjects'][0],
        question_text='P1 AI generated question',
        question_type='SHORT',
        difficulty_level='MEDIUM',
        marks='2.00',
        answer_text='Expected answer',
        created_by=seed_data['users']['admin'],
        is_ai_generated=True,
        is_active=True,
    )


@pytest.mark.django_db
class TestQuestionAIFields:
    def test_source_content_block_field_exists(self, question):
        assert hasattr(question, 'source_content_block')

    def test_source_content_block_nullable(self, question):
        assert question.source_content_block is None

    def test_link_question_to_content_block(self, question, ai_source_block):
        question.source_content_block = ai_source_block
        question.save()
        question.refresh_from_db()
        assert question.source_content_block == ai_source_block

    def test_is_ai_generated_defaults_false(self, question):
        assert question.is_ai_generated is False

    def test_verified_by_nullable(self, question):
        assert question.verified_by is None
        assert question.verified_at is None

    def test_verify_question_via_api(self, seed_data, api, ai_question):
        response = api.patch(
            f'/api/examinations/questions/{ai_question.id}/',
            {
                'verified_by': seed_data['users']['admin'].id,
                'verified_at': timezone.now().isoformat(),
            },
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )
        assert response.status_code == 200
        ai_question.refresh_from_db()
        assert ai_question.verified_by is not None

    def test_source_content_block_in_serializer(self, seed_data, api, question):
        response = api.get(
            f'/api/examinations/questions/{question.id}/',
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )
        assert response.status_code == 200
        payload = response.json()
        assert 'source_content_block' in payload
        assert 'is_ai_generated' in payload
