"""Messages answered: each incoming message that starts or continues a thread needs a reply."""
import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from messaging.models import Message, MessageThread, ThreadParticipant
from parents.models import ParentMessage

from .conftest import measure, stamp

pytestmark = pytest.mark.django_db


def pm(perf, sender, recipient, when, thread):
    m = ParentMessage.objects.create(
        school=perf['school_a'], sender_user=sender, recipient_user=recipient,
        student=perf['students'][0], message='hi', thread_id=thread,
    )
    stamp(m, created_at=when)


def test_parent_and_staff_threads(perf):
    teacher = perf['staff'][0]
    tu, admin = teacher.user, perf['users']['admin']
    now = timezone.now()
    today = timezone.localdate()

    # Parent thread: answered in 2 hours (on time), then a new question answered after 3 days (late).
    t1 = uuid.uuid4()
    pm(perf, admin, tu, now - timedelta(days=9), t1)
    pm(perf, admin, tu, now - timedelta(days=9) + timedelta(minutes=5), t1)  # same run, not a new item
    pm(perf, tu, admin, now - timedelta(days=9) + timedelta(hours=2), t1)
    pm(perf, admin, tu, now - timedelta(days=7), t1)
    pm(perf, tu, admin, now - timedelta(days=4), t1)

    # A thread the teacher started that nobody answered owes nothing.
    pm(perf, tu, admin, now - timedelta(days=5), uuid.uuid4())

    # Staff thread: incoming 3 days ago, never answered -> missed.
    thread = MessageThread.objects.create(school=perf['school_a'], created_by=admin)
    ThreadParticipant.objects.create(thread=thread, user=admin)
    ThreadParticipant.objects.create(thread=thread, user=tu)
    msg = Message.objects.create(thread=thread, sender=admin, body='please reply')
    stamp(msg, created_at=now - timedelta(days=3))

    # Incoming one hour ago: still inside the 24 hours, not due yet.
    pm(perf, admin, tu, now - timedelta(hours=1), uuid.uuid4())

    m = measure(perf, 'messages_answered', today - timedelta(days=10), today)[teacher.id]
    assert (m['due'], m['done'], m['on_time']) == (3, 2, 1)
    assert m['score'] == 50
    assert sorted(x['reason'] for x in m['missed']) == ['not answered', 'replied late']
