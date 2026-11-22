"""Lesson plans: one published plan per timetable period, on or before the lesson date."""
from datetime import time

import pytest

from academics.models import TimetableEntry, TimetableSlot
from lms.models import LessonPlan

from .conftest import MON, TUE, WED, at, measure, stamp

pytestmark = pytest.mark.django_db


@pytest.fixture
def timetable(perf):
    teacher = perf['staff'][0]
    slot = TimetableSlot.objects.create(
        school=perf['school_a'], name='P1', start_time=time(8), end_time=time(8, 40), order=1,
    )
    for day in ('MON', 'TUE'):
        TimetableEntry.objects.create(
            school=perf['school_a'], academic_year=perf['academic_year'], class_obj=perf['classes'][0],
            day=day, slot=slot, subject=perf['subjects'][0], teacher=teacher,
        )
    return teacher


def plan(perf, teacher, day, made, status='PUBLISHED'):
    p = LessonPlan.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'], class_obj=perf['classes'][0],
        subject=perf['subjects'][0], teacher=teacher, title='t', description='d',
        lesson_date=day, status=status,
    )
    stamp(p, created_at=made)
    return p


def test_on_time_and_late_plans(perf, timetable):
    plan(perf, timetable, MON, at(MON, 7))     # on time
    plan(perf, timetable, TUE, at(WED, 9))     # after the lesson -> half
    m = measure(perf, 'lesson_plans')[timetable.id]
    assert (m['due'], m['done'], m['on_time']) == (2, 2, 1)
    assert m['score'] == 75


def test_draft_does_not_count_and_extra_plans_are_capped(perf, timetable):
    plan(perf, timetable, MON, at(MON, 7))
    plan(perf, timetable, MON, at(MON, 7))     # second plan for one period: capped
    plan(perf, timetable, TUE, at(MON, 7), status='DRAFT')
    m = measure(perf, 'lesson_plans')[timetable.id]
    assert (m['due'], m['done']) == (2, 1)
    assert m['score'] == 50


def test_no_timetable_means_not_applicable(perf, timetable):
    assert measure(perf, 'lesson_plans')[perf['staff'][1].id]['applicable'] is False
