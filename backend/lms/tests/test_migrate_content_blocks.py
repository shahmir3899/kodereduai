from io import StringIO

import pytest
from django.core.management import call_command

from lms.models import Book, Chapter, ContentBlock


@pytest.fixture
def chapter_with_json_content(seed_data):
    book = Book.objects.create(
        school=seed_data['school_a'],
        class_obj=seed_data['classes'][0],
        subject=seed_data['subjects'][0],
        title='P1 Migration Book',
        language='en',
    )
    chapter = Chapter.objects.create(
        book=book,
        title='P1 Migration Chapter',
        chapter_number=1,
        content_blocks=[
            {'type': 'definition', 'text': 'Definition text'},
            {'type': 'example', 'text': 'Worked example text'},
        ],
    )
    return chapter


@pytest.mark.django_db
class TestMigrateContentBlocksCommand:
    def test_dry_run_produces_no_records(self, chapter_with_json_content):
        initial_count = ContentBlock.objects.count()
        out = StringIO()
        call_command('migrate_content_blocks', dry_run=True, stdout=out)
        assert ContentBlock.objects.count() == initial_count
        assert 'Created:' in out.getvalue()

    def test_command_creates_blocks_from_chapter_json(self, chapter_with_json_content):
        call_command('migrate_content_blocks')
        blocks = ContentBlock.objects.filter(chapter=chapter_with_json_content)
        assert blocks.count() > 0

    def test_command_is_idempotent(self, chapter_with_json_content):
        call_command('migrate_content_blocks')
        count_after_first = ContentBlock.objects.count()
        call_command('migrate_content_blocks')
        count_after_second = ContentBlock.objects.count()
        assert count_after_first == count_after_second

    def test_command_logs_summary(self, chapter_with_json_content):
        out = StringIO()
        call_command('migrate_content_blocks', stdout=out)
        output = out.getvalue()
        assert 'Created:' in output
        assert 'Skipped:' in output
        assert 'Errors:' in output
