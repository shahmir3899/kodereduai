import pytest

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
        title='P1 ContentBlock Book',
        language='en',
    )
    chapter = Chapter.objects.create(
        book=book,
        title='P1 ContentBlock Chapter',
        chapter_number=1,
    )
    topic = Topic.objects.create(
        chapter=chapter,
        title='P1 ContentBlock Topic',
        topic_number=1,
    )
    return {'chapter': chapter, 'topic': topic}


@pytest.mark.django_db
class TestContentBlockModel:
    def test_create_content_block_linked_to_chapter(self, curriculum_topic):
        chapter = curriculum_topic['chapter']
        block = ContentBlock.objects.create(
            chapter=chapter,
            block_type='text',
            content_text='This is a paragraph.',
            sequence_order=1,
        )
        assert block.id is not None
        assert block.block_type == 'text'
        assert block.is_active is True

    def test_create_content_block_linked_to_topic(self, curriculum_topic):
        topic = curriculum_topic['topic']
        block = ContentBlock.objects.create(
            topic=topic,
            block_type='definition',
            content_text='A definition block.',
            sequence_order=1,
        )
        assert block.topic == topic
        assert block.chapter is None

    def test_str_representation(self, curriculum_topic):
        topic = curriculum_topic['topic']
        block = ContentBlock.objects.create(
            topic=topic,
            block_type='example',
            content_text='This is a worked example with enough text to test truncation behavior.',
            sequence_order=1,
        )
        assert 'example' in str(block)
        assert len(str(block)) <= 80

    def test_default_ordering_by_sequence(self, curriculum_topic):
        topic = curriculum_topic['topic']
        ContentBlock.objects.create(
            topic=topic,
            block_type='text',
            content_text='Third',
            sequence_order=3,
        )
        ContentBlock.objects.create(
            topic=topic,
            block_type='text',
            content_text='First',
            sequence_order=1,
        )
        ContentBlock.objects.create(
            topic=topic,
            block_type='text',
            content_text='Second',
            sequence_order=2,
        )
        blocks = list(ContentBlock.objects.filter(topic=topic))
        assert blocks[0].content_text == 'First'
        assert blocks[1].content_text == 'Second'
        assert blocks[2].content_text == 'Third'

    def test_soft_delete_sets_inactive(self, curriculum_topic):
        topic = curriculum_topic['topic']
        block = ContentBlock.objects.create(
            topic=topic,
            block_type='text',
            content_text='To be deleted',
            sequence_order=1,
        )
        block.is_active = False
        block.save()
        assert ContentBlock.objects.filter(id=block.id, is_active=True).count() == 0

    def test_all_block_types_are_valid(self, curriculum_topic):
        topic = curriculum_topic['topic']
        valid_types = [
            'text',
            'definition',
            'example',
            'exercise',
            'formula',
            'diagram_desc',
            'summary',
            'key_point',
        ]
        for index, block_type in enumerate(valid_types, start=1):
            block = ContentBlock.objects.create(
                topic=topic,
                block_type=block_type,
                content_text=f'Block of type {block_type}',
                sequence_order=index,
            )
            assert block.block_type == block_type

    def test_content_rich_accepts_json(self, curriculum_topic):
        topic = curriculum_topic['topic']
        rich = {'format': 'table', 'rows': [['a', 'b'], ['c', 'd']]}
        block = ContentBlock.objects.create(
            topic=topic,
            block_type='text',
            content_text='Table block',
            content_rich=rich,
            sequence_order=1,
        )
        assert block.content_rich['format'] == 'table'
