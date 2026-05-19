import pytest
from django.db import connection

from examinations.models import Question
from lms.models import Book, Chapter, ContentBlock, Topic


@pytest.fixture
def curriculum_topic(seed_data):
    school = seed_data['school_a']
    class_obj = seed_data['classes'][0]
    subject = seed_data['subjects'][0]

    book = Book.objects.create(
        school=school,
        class_obj=class_obj,
        subject=subject,
        title='Phase 2 Embedding Book',
        language='en',
    )
    chapter = Chapter.objects.create(
        book=book,
        title='Phase 2 Embedding Chapter',
        chapter_number=1,
    )
    topic = Topic.objects.create(
        chapter=chapter,
        title='Phase 2 Embedding Topic',
        topic_number=1,
    )
    return {'chapter': chapter, 'topic': topic}


@pytest.mark.django_db
class TestEmbeddingFields:
    def test_pgvector_extension_is_enabled(self):
        if connection.vendor != 'postgresql':
            pytest.skip('pgvector extension check requires PostgreSQL')

        with connection.cursor() as cursor:
            cursor.execute("SELECT extname FROM pg_extension WHERE extname = 'vector';")
            result = cursor.fetchone()
        assert result is not None, 'pgvector extension not installed'

    def test_content_block_has_embedding_field(self):
        block = ContentBlock()
        assert hasattr(block, 'embedding')

    def test_question_has_embedding_field(self):
        question = Question()
        assert hasattr(question, 'embedding')

    def test_topic_has_embedding_field(self):
        topic = Topic()
        assert hasattr(topic, 'embedding')

    def test_embedding_is_nullable_by_default(self, curriculum_topic):
        topic = curriculum_topic['topic']
        block = ContentBlock.objects.create(
            topic=topic,
            block_type='text',
            content_text='Test block',
            sequence_order=1,
        )
        assert block.embedding is None

    def test_embedding_can_store_vector(self, curriculum_topic):
        topic = curriculum_topic['topic']
        block = ContentBlock.objects.create(
            topic=topic,
            block_type='text',
            content_text='Test block',
            sequence_order=1,
        )
        fake_embedding = [0.1] * 1536
        block.embedding = fake_embedding
        block.save()
        block.refresh_from_db()
        assert len(block.embedding) == 1536