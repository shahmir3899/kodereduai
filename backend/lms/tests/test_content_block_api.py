import pytest
from django.test import Client

from lms.models import Book, Chapter, ContentBlock, Topic


def _results(resp):
    data = resp.json() if resp.status_code == 200 else {}
    if isinstance(data, dict):
        return data.get('results', [])
    return data


@pytest.fixture
def topic_school_a(seed_data):
    school = seed_data['school_a']
    class_obj = seed_data['classes'][0]
    subject = seed_data['subjects'][0]

    book = Book.objects.create(
        school=school,
        class_obj=class_obj,
        subject=subject,
        title='P1 API ContentBlock Book',
        language='en',
    )
    chapter = Chapter.objects.create(
        book=book,
        title='P1 API ContentBlock Chapter',
        chapter_number=1,
    )
    topic = Topic.objects.create(
        chapter=chapter,
        title='P1 API ContentBlock Topic',
        topic_number=1,
    )
    return topic


@pytest.mark.django_db
class TestContentBlockAPI:
    def test_list_blocks_by_topic(self, seed_data, api, topic_school_a):
        ContentBlock.objects.create(topic=topic_school_a, block_type='text', content_text='Block A', sequence_order=1)
        ContentBlock.objects.create(topic=topic_school_a, block_type='definition', content_text='Block B', sequence_order=2)

        response = api.get(
            f'/api/lms/content-blocks/?topic_id={topic_school_a.id}',
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )
        assert response.status_code == 200
        assert len(_results(response)) == 2

    def test_list_blocks_returns_correct_order(self, seed_data, api, topic_school_a):
        ContentBlock.objects.create(topic=topic_school_a, block_type='text', content_text='Second', sequence_order=2)
        ContentBlock.objects.create(topic=topic_school_a, block_type='text', content_text='First', sequence_order=1)

        response = api.get(
            f'/api/lms/content-blocks/?topic_id={topic_school_a.id}',
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )
        assert response.status_code == 200
        assert _results(response)[0]['content_text'] == 'First'

    def test_create_content_block(self, seed_data, api, topic_school_a):
        payload = {
            'topic': topic_school_a.id,
            'block_type': 'definition',
            'content_text': 'Photosynthesis is the process...',
            'sequence_order': 1,
        }
        response = api.post('/api/lms/content-blocks/', payload, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert response.status_code == 201
        assert response.json()['block_type'] == 'definition'

    def test_update_content_block(self, seed_data, api, topic_school_a):
        block = ContentBlock.objects.create(
            topic=topic_school_a,
            block_type='text',
            content_text='Old text',
            sequence_order=1,
        )
        response = api.patch(
            f'/api/lms/content-blocks/{block.id}/',
            {'content_text': 'Updated text'},
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )
        assert response.status_code == 200
        assert response.json()['content_text'] == 'Updated text'

    def test_delete_soft_deletes_block(self, seed_data, api, topic_school_a):
        block = ContentBlock.objects.create(
            topic=topic_school_a,
            block_type='text',
            content_text='To delete',
            sequence_order=1,
        )
        response = api.delete(
            f'/api/lms/content-blocks/{block.id}/',
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )
        assert response.status_code in (200, 204)
        block.refresh_from_db()
        assert block.is_active is False

    def test_list_excludes_inactive_blocks(self, seed_data, api, topic_school_a):
        ContentBlock.objects.create(
            topic=topic_school_a,
            block_type='text',
            content_text='Active',
            sequence_order=1,
            is_active=True,
        )
        ContentBlock.objects.create(
            topic=topic_school_a,
            block_type='text',
            content_text='Inactive',
            sequence_order=2,
            is_active=False,
        )

        response = api.get(
            f'/api/lms/content-blocks/?topic_id={topic_school_a.id}',
            seed_data['tokens']['admin'],
            seed_data['SID_A'],
        )
        assert response.status_code == 200
        assert len(_results(response)) == 1

    def test_tenant_isolation(self, seed_data, api, topic_school_a):
        ContentBlock.objects.create(
            topic=topic_school_a,
            block_type='text',
            content_text='School A block',
            sequence_order=1,
        )

        response = api.get(
            f'/api/lms/content-blocks/?topic_id={topic_school_a.id}',
            seed_data['tokens']['admin_b'],
            seed_data['SID_B'],
        )
        assert response.status_code == 200
        assert len(_results(response)) == 0

    def test_unauthenticated_request_rejected(self, topic_school_a):
        client = Client()
        response = client.get(f'/api/lms/content-blocks/?topic_id={topic_school_a.id}')
        assert response.status_code == 401
