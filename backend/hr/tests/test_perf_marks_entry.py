"""Exam marks: the subject teacher owes a mark or absent flag per enrolled student within N days."""
from datetime import date
from decimal import Decimal

import pytest

from academics.models import ClassSubject
from examinations.models import Exam, ExamSubject, ExamType, StudentMark

from .conftest import at, measure, stamp

pytestmark = pytest.mark.django_db

NOV = (date(2025, 11, 1), date(2025, 11, 30))
EXAM_DAY = date(2025, 11, 3)


@pytest.fixture
def exam(perf, enrol_class_1):
    teacher = perf['staff'][1]
    ClassSubject.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'], class_obj=perf['classes'][0],
        subject=perf['subjects'][0], teacher=teacher,
    )
    exam_type = ExamType.objects.create(school=perf['school_a'], name='Mid', weight=Decimal('100'))
    ex = Exam.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'], exam_type=exam_type,
        class_obj=perf['classes'][0], name='Midterm',
    )
    es = ExamSubject.objects.create(school=perf['school_a'], exam=ex, subject=perf['subjects'][0], exam_date=EXAM_DAY)
    return teacher, es, enrol_class_1


def enter(perf, es, student, saved_on, marks=Decimal('50'), absent=False):
    m = StudentMark.objects.create(
        school=perf['school_a'], exam_subject=es, student=student,
        marks_obtained=None if absent else marks, is_absent=absent,
    )
    stamp(m, created_at=at(saved_on, 10))


def test_on_time_late_absent_and_missing(perf, exam):
    teacher, es, students = exam
    enter(perf, es, students[0], date(2025, 11, 5))
    enter(perf, es, students[1], date(2025, 11, 10), absent=True)   # deadline day: on time
    enter(perf, es, students[2], date(2025, 11, 20))                # late -> half
    m = measure(perf, 'marks_entry', *NOV)[teacher.id]
    assert (m['due'], m['done'], m['on_time']) == (4, 3, 2)
    assert m['score'] == pytest.approx(100 * 2.5 / 4, abs=0.1)
    assert m['missed'][0]['reason'] == '1 marks not entered'


def test_blank_mark_row_is_not_done(perf, exam):
    teacher, es, students = exam
    StudentMark.objects.create(school=perf['school_a'], exam_subject=es, student=students[0])
    assert measure(perf, 'marks_entry', *NOV)[teacher.id]['done'] == 0


def test_other_teachers_do_not_owe_these_marks(perf, exam):
    assert measure(perf, 'marks_entry', *NOV)[perf['staff'][0].id]['applicable'] is False
