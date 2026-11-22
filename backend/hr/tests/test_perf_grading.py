"""Homework grading: graded within N days earns full credit; work still inside the window waits."""
from datetime import timedelta

import pytest
from django.utils import timezone

from lms.models import Assignment, AssignmentSubmission

from .conftest import measure, stamp

pytestmark = pytest.mark.django_db


def test_on_time_late_overdue_and_not_yet_due(perf):
    t = perf['staff'][0]
    a = Assignment.objects.create(
        school=perf['school_a'], class_obj=perf['classes'][0], subject=perf['subjects'][0],
        teacher=t, title='hw', description='d', status='PUBLISHED',
    )
    now = timezone.now()
    cases = [
        (now - timedelta(days=8), now - timedelta(days=7)),   # graded in 1 day: on time
        (now - timedelta(days=8), now - timedelta(days=1)),   # graded in 7 days: late, half
        (now - timedelta(days=6), None),                      # 6 days ungraded: missed
        (now - timedelta(days=1), None),                      # 1 day: still inside 3 days, not due
    ]
    for i, (submitted, graded) in enumerate(cases):
        s = AssignmentSubmission.objects.create(
            assignment=a, student=perf['students'][i], school=perf['school_a'],
            status='GRADED' if graded else 'SUBMITTED', graded_at=graded,
        )
        stamp(s, submitted_at=submitted)
    today = timezone.localdate()
    m = measure(perf, 'grading', today - timedelta(days=10), today)[t.id]
    assert (m['due'], m['done'], m['on_time']) == (3, 2, 1)
    assert m['score'] == 50
    assert [x['reason'] for x in m['missed']] == ['not graded']
