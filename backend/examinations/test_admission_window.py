"""Exams and homework only expect a student from their admission date.

A student admitted after an exam's last day could never get marks, so they kept
"marks entry complete" false (blocking Announce Results) and sat in the results
as a blank row. Builds on the shared seed_data/seed_sections fixtures.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from django.utils import timezone as dj_timezone

from academic_sessions.models import StudentEnrollment
from examinations.models import Exam, ExamSubject, ExamType, StudentMark
from examinations.views import _annotate_marks_completion, _departed_mark_errors, _exam_roster
from lms.models import Assignment
from lms.serializers import AssignmentSubmissionCreateSerializer
from notifications.triggers import _students_for_exam
from students.models import Student

pytestmark = pytest.mark.django_db

EXAM_START, EXAM_END = date(2025, 9, 1), date(2025, 9, 5)


@pytest.fixture
def exam(seed_data, seed_sections):
    school = seed_data['school_a']
    return Exam.objects.create(
        school=school, academic_year=seed_data['academic_year'],
        exam_type=ExamType.objects.create(school=school, name='Term', weight=Decimal('100.00')),
        class_obj=seed_sections['master'], name='Term 1', start_date=EXAM_START, end_date=EXAM_END,
    )


@pytest.fixture
def newcomer(seed_sections):
    """Section A's second student, admitted after the exam ended."""
    student = seed_sections['a_students'][1]
    Student.objects.filter(pk=student.pk).update(admission_date=EXAM_END + timedelta(days=10))
    return student


def _enrolled_count(exam):
    return _annotate_marks_completion(Exam.objects.filter(pk=exam.pk)).get().enrolled_count


def test_head_count_leaves_out_a_student_admitted_after_the_exam(exam, newcomer):
    assert _enrolled_count(exam) == 3


def test_head_count_includes_a_student_admitted_on_the_last_day(exam, newcomer):
    Student.objects.filter(pk=newcomer.pk).update(admission_date=EXAM_END)

    assert _enrolled_count(exam) == 4


def test_head_count_without_admission_date_has_no_bound(exam, newcomer):
    Student.objects.filter(pk=newcomer.pk).update(admission_date=None)

    assert _enrolled_count(exam) == 4


def test_head_count_of_an_exam_without_dates_has_no_bound(exam, newcomer):
    Exam.objects.filter(pk=exam.pk).update(start_date=None, end_date=None)

    assert _enrolled_count(exam) == 4


def test_results_roster_leaves_out_a_student_admitted_after_the_exam(seed_data, exam, newcomer, seed_sections):
    students, rolls = _exam_roster(seed_data['SID_A'], exam)

    assert newcomer.id not in {s.id for s in students}
    assert newcomer.id not in rolls
    assert len(students) == 3


def test_marks_entry_refuses_a_student_admitted_after_the_exam(seed_data, exam, newcomer):
    errors = _departed_mark_errors(seed_data['SID_A'], exam, [newcomer.id])

    assert 'was admitted on' in errors[newcomer.id]
    assert 'marks' in errors[newcomer.id]


def test_marks_entry_accepts_a_student_admitted_before_the_exam(seed_data, exam, seed_sections):
    ok = seed_sections['a_students'][0]
    Student.objects.filter(pk=ok.pk).update(admission_date=EXAM_START - timedelta(days=30))

    assert _departed_mark_errors(seed_data['SID_A'], exam, [ok.id]) == {}


def test_bulk_marks_entry_reports_the_late_student_and_saves_the_rest(seed_data, exam, newcomer, seed_sections, api):
    subject = ExamSubject.objects.create(
        school=seed_data['school_a'], exam=exam, subject=seed_data['subjects'][0],
        total_marks=Decimal('100.00'), passing_marks=Decimal('33.00'),
    )
    stay = seed_sections['a_students'][0]

    response = api.post(
        '/api/examinations/marks/bulk_entry/',
        {'exam_subject_id': subject.id, 'marks': [
            {'student_id': stay.id, 'marks_obtained': 70},
            {'student_id': newcomer.id, 'marks_obtained': 80},
        ]},
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code < 500, response.content[:300]
    assert StudentMark.objects.filter(exam_subject=subject, student=stay).exists()
    assert not StudentMark.objects.filter(exam_subject=subject, student=newcomer).exists()


def test_exam_notifications_skip_a_student_admitted_after_the_exam(exam, newcomer):
    assert newcomer.id not in {s.id for s in _students_for_exam(exam)}


def _assignment(seed_data, seed_sections):
    return Assignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=seed_sections['master'], subject=seed_data['subjects'][0], teacher=seed_data['staff'][0],
        title='Homework', description='Do it', requires_submission=True,
        due_date=datetime(2025, 9, 15, tzinfo=timezone.utc), status=Assignment.Status.PUBLISHED,
    )


def _submission(seed_data, assignment, student):
    return AssignmentSubmissionCreateSerializer(data={
        'assignment': assignment.id, 'student': student.id, 'school': seed_data['school_a'].id,
        'submission_text': 'done',
    })


def test_a_student_who_has_left_cannot_submit_homework(seed_data, seed_sections):
    assignment = _assignment(seed_data, seed_sections)
    gone = seed_sections['a_students'][1]
    StudentEnrollment.objects.filter(student=gone, academic_year=seed_data['academic_year']).update(
        status='WITHDRAWN', is_active=False, left_date=dj_timezone.localdate() - timedelta(days=1),
    )

    serializer = _submission(seed_data, assignment, gone)

    assert not serializer.is_valid()
    assert 'left the school' in str(serializer.errors['student'])


def test_a_student_admitted_after_the_due_date_can_still_submit_homework(seed_data, seed_sections):
    assignment = _assignment(seed_data, seed_sections)
    late = seed_sections['a_students'][1]
    Student.objects.filter(pk=late.pk).update(admission_date=date(2025, 10, 1))

    serializer = _submission(seed_data, assignment, late)

    assert serializer.is_valid(), serializer.errors
