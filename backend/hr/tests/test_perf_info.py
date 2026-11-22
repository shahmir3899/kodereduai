"""Information-only figures: syllabus on schedule, questions added, class results, leave days.
None of them may change the score."""
from datetime import date
from decimal import Decimal

import pytest

from academics.models import ClassSubject
from examinations.models import Exam, ExamSubject, ExamType, Question, StudentMark
from hr.models import LeaveApplication
from lms.models import Book, Chapter, LessonPlan, Topic, TopicSchedule

from .conftest import MON, SAT, THU, TUE, WED, at, stamp
from hr.performance.service import compute

pytestmark = pytest.mark.django_db


def info_of(perf, staff):
    report = compute(perf['SID_A'], MON, SAT)
    return next(t for t in report['teachers'] if t['staff_id'] == staff.id)


@pytest.fixture
def subject_teacher(perf):
    t = perf['staff'][0]
    ClassSubject.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'], class_obj=perf['classes'][0],
        subject=perf['subjects'][0], teacher=t,
    )
    return t


def test_syllabus_on_schedule(perf, subject_teacher):
    book = Book.objects.create(school=perf['school_a'], class_obj=perf['classes'][0], subject=perf['subjects'][0], title='B')
    ch = Chapter.objects.create(book=book, title='C', chapter_number=1)
    topics = [Topic.objects.create(chapter=ch, title=f'T{i}', topic_number=i) for i in (1, 2, 3)]
    for topic, planned in zip(topics, (MON, TUE, WED)):
        TopicSchedule.objects.create(topic=topic, academic_year=perf['academic_year'], planned_date=planned)

    def plan(topic, day):
        p = LessonPlan.objects.create(
            school=perf['school_a'], academic_year=perf['academic_year'], class_obj=perf['classes'][0],
            subject=perf['subjects'][0], teacher=subject_teacher, title='t', description='d',
            lesson_date=day, status='PUBLISHED',
        )
        p.planned_topics.add(topic)

    plan(topics[0], MON)   # on its planned day
    plan(topics[1], THU)   # two days late
    info = info_of(perf, subject_teacher)['info']
    assert info['syllabus_on_schedule'] == {'planned': 3, 'taught_on_time': 1}


def test_questions_results_and_leave(perf, subject_teacher, enrol_class_1):
    for _ in range(2):
        q = Question.objects.create(
            school=perf['school_a'], subject=perf['subjects'][0], question_text='q', created_by=subject_teacher.user,
        )
        stamp(q, created_at=at(TUE))

    exam_type = ExamType.objects.create(school=perf['school_a'], name='Mid', weight=Decimal('100'))
    exam = Exam.objects.create(
        school=perf['school_a'], academic_year=perf['academic_year'], exam_type=exam_type,
        class_obj=perf['classes'][0], name='Midterm',
    )
    es = ExamSubject.objects.create(
        school=perf['school_a'], exam=exam, subject=perf['subjects'][0], exam_date=MON, total_marks=Decimal('50'),
    )
    StudentMark.objects.create(school=perf['school_a'], exam_subject=es, student=enrol_class_1[0], marks_obtained=Decimal('40'))
    StudentMark.objects.create(school=perf['school_a'], exam_subject=es, student=enrol_class_1[1], marks_obtained=Decimal('30'))
    StudentMark.objects.create(school=perf['school_a'], exam_subject=es, student=enrol_class_1[2], is_absent=True)

    LeaveApplication.objects.create(
        school=perf['school_a'], staff_member=subject_teacher, start_date=WED, end_date=date(2025, 11, 9),
        reason='x', status='APPROVED',
    )
    info = info_of(perf, subject_teacher)['info']
    assert info['questions_added'] == 2
    assert info['class_result_average'] == 70.0        # 80% and 60%; the absent student is left out
    assert info['marks_counted'] == 2
    assert info['leave_days'] == 4                      # Wed to Sat; Sunday the 9th is not a working day


def test_info_never_changes_the_score(perf, subject_teacher):
    before = info_of(perf, subject_teacher)['overall_score']
    for _ in range(5):
        Question.objects.create(
            school=perf['school_a'], subject=perf['subjects'][0], question_text='q', created_by=subject_teacher.user,
        )
    after = info_of(perf, subject_teacher)
    assert after['overall_score'] == before
    assert after['info']['questions_added'] == 0  # created today, outside the 2025 week
