"""Book content: blocks the teacher added plus edits they made, capped at a pro-rated target."""
import pytest

from hr.models import TeacherPerformanceConfig
from lms.models import Book, Chapter, ContentBlock, ContentRevision

from .conftest import MON, at, measure, stamp

pytestmark = pytest.mark.django_db


def chapter_for(perf, school):
    book = Book.objects.create(school=school, class_obj=perf['classes'][0], subject=perf['subjects'][0], title='B')
    return Chapter.objects.create(book=book, title='C', chapter_number=1)


def test_created_and_edited_blocks_count_other_schools_do_not(perf):
    t = perf['staff'][0]
    # 26 a month = 1 per working day, so the 6-day week asks for 6.
    TeacherPerformanceConfig.objects.update_or_create(
        school=perf['school_a'], defaults={'content_blocks_per_month': 26},
    )
    ch = chapter_for(perf, perf['school_a'])
    blocks = []
    for _ in range(4):
        b = ContentBlock.objects.create(chapter=ch, content_text='x', created_by=t.user)
        stamp(b, created_at=at(MON))
        blocks.append(b)
    rev = ContentRevision.objects.create(content_block=blocks[0], content_text='old', changed_by=t.user)
    stamp(rev, changed_at=at(MON))
    other = ContentBlock.objects.create(
        chapter=chapter_for(perf, perf['school_b']), content_text='x', created_by=t.user,
    )
    stamp(other, created_at=at(MON))

    m = measure(perf, 'book_content')[t.id]
    assert (m['due'], m['done']) == (6, 5)


def test_api_create_and_edit_record_the_author(perf, api):
    ch = chapter_for(perf, perf['school_a'])
    admin, token, sid = perf['users']['admin'], perf['tokens']['admin'], perf['SID_A']
    resp = api.post('/api/lms/content-blocks/', {'chapter': ch.id, 'content_text': 'new'}, token, sid)
    assert resp.status_code == 201, resp.content
    block = ContentBlock.objects.get(id=resp.json()['id'])
    assert block.created_by == admin
    resp = api.patch(f'/api/lms/content-blocks/{block.id}/', {'content_text': 'edited'}, token, sid)
    assert resp.status_code == 200, resp.content
    assert block.revisions.get().changed_by == admin
