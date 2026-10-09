"""Marks entry used to cost an enrollment lookup plus an update_or_create per student
(~5 round trips each, ~0.1s apiece to the Singapore DB). Saving a subject's marks must
cost a fixed handful of queries however big the class is, and keep every rule."""
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from academic_sessions.models import StudentEnrollment
from examinations.models import Exam, ExamSubject, ExamType, StudentMark
from students.models import Student

pytestmark = pytest.mark.django_db

URL = '/api/examinations/marks/bulk_entry/'


@pytest.fixture
def exam(seed_data):
    """A class of 34 enrolled students and one exam subject."""
    school, year = seed_data['school_a'], seed_data['academic_year']
    class_obj = seed_data['classes'][0]
    students = [s for s in seed_data['students'] if s.class_obj_id == class_obj.id]
    for i in range(30):
        students.append(Student.objects.create(
            school=school, class_obj=class_obj, roll_number=f'm{i}',
            name=f'ZZ_marks_{i}', is_active=True, status='ACTIVE',
        ))
    enrollments = {}
    for s in students:
        enrollments[s.id], _ = StudentEnrollment.objects.get_or_create(
            school=school, student=s, academic_year=year,
            defaults={'class_obj': class_obj, 'roll_number': s.roll_number,
                      'status': 'ACTIVE', 'is_active': True},
        )
    the_exam = Exam.objects.create(
        school=school, academic_year=year, class_obj=class_obj, name='Batch Exam',
        exam_type=ExamType.objects.create(school=school, name='Batch', weight=Decimal('100.00')),
        status=Exam.Status.COMPLETED,
    )
    subject = ExamSubject.objects.create(
        school=school, exam=the_exam, subject=seed_data['subjects'][0],
        total_marks=Decimal('100.00'), passing_marks=Decimal('33.00'),
    )
    return {**seed_data, 'students': students, 'enrollments': enrollments, 'exam_subject': subject}


def save(api, ctx, students, **fields):
    payload = {
        'exam_subject_id': ctx['exam_subject'].id,
        'marks': [{'student_id': s.id, 'marks_obtained': 50 + i % 40, **fields} for i, s in enumerate(students)],
    }
    return api.post(URL, payload, ctx['tokens']['admin'], ctx['SID_A'])


def count_queries(api, ctx, students):
    with CaptureQueriesContext(connection) as q:
        resp = save(api, ctx, students)
    assert resp.status_code == 200, resp.content
    return len(q)


class TestQueryBudget:
    def test_cost_does_not_grow_with_class_size(self, api, exam):
        small = exam['students'][:4]
        count_queries(api, exam, small)  # warm caches/permissions
        StudentMark.objects.all().delete()

        few = count_queries(api, exam, small)
        StudentMark.objects.all().delete()
        many = count_queries(api, exam, exam['students'])

        assert many - few <= 3, f'{few} queries for 4 students, {many} for {len(exam["students"])}'

    def test_re_saving_existing_marks_is_also_flat(self, api, exam):
        count_queries(api, exam, exam['students'])

        again = count_queries(api, exam, exam['students'])

        assert again <= 40, f'{again} queries to re-save {len(exam["students"])} marks'


class TestBehaviourIsUnchanged:
    def test_creates_then_updates_and_reports_counts(self, api, exam):
        assert save(api, exam, exam['students'][:3]).json()['created'] == 3

        body = save(api, exam, exam['students'][:5]).json()

        assert (body['created'], body['updated'], body['errors']) == (2, 3, [])
        assert body['message'] == '5 marks saved.'
        assert StudentMark.objects.filter(exam_subject=exam['exam_subject']).count() == 5

    def test_the_enrollment_is_attached_to_each_mark(self, api, exam):
        save(api, exam, exam['students'][:6])

        for mark in StudentMark.objects.filter(exam_subject=exam['exam_subject']):
            assert mark.enrollment_id == exam['enrollments'][mark.student_id].id

    def test_absent_clears_marks_and_remarks_are_saved(self, api, exam):
        student = exam['students'][0]
        save(api, exam, [student])

        save(api, exam, [student], is_absent=True, remarks='ill')

        mark = StudentMark.objects.get(exam_subject=exam['exam_subject'], student=student)
        assert (mark.marks_obtained, mark.is_absent, mark.remarks) == (None, True, 'ill')

    def test_an_existing_ai_comment_survives_a_marks_resave(self, api, exam):
        student = exam['students'][0]
        save(api, exam, [student])
        StudentMark.objects.filter(student=student).update(ai_comment='Keep me', ai_comment_source='EDITED')

        save(api, exam, [student])

        mark = StudentMark.objects.get(student=student, exam_subject=exam['exam_subject'])
        assert (mark.ai_comment, mark.ai_comment_source) == ('Keep me', 'EDITED')

    def test_a_removed_student_is_refused_but_the_rest_are_saved(self, api, exam):
        gone = exam['students'][0]
        gone.soft_delete()

        body = save(api, exam, exam['students'][:3]).json()

        assert (body['created'], [e['student_id'] for e in body['errors']]) == (2, [gone.id])
        assert not StudentMark.objects.filter(student=gone).exists()

    def test_a_repeated_student_keeps_the_last_entry(self, api, exam):
        student = exam['students'][0]
        payload = {
            'exam_subject_id': exam['exam_subject'].id,
            'marks': [{'student_id': student.id, 'marks_obtained': 10}, {'student_id': student.id, 'marks_obtained': 80}],
        }

        resp = api.post(URL, payload, exam['tokens']['admin'], exam['SID_A'])

        assert resp.status_code == 200, resp.content
        assert StudentMark.objects.get(student=student, exam_subject=exam['exam_subject']).marks_obtained == Decimal('80')

    def test_if_the_batch_write_fails_marks_are_still_saved_one_by_one(self, api, exam):
        with patch('examinations.views.StudentMark.objects.bulk_create', side_effect=RuntimeError('boom')):
            body = save(api, exam, exam['students'][:3]).json()

        assert (body['created'], body['errors']) == (3, [])
