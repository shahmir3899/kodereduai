"""Every delete of a business-critical model leaves an AdminActionLog entry, whatever
path it takes (API, shell, script). Exam deletes also copy the marks they erase."""
from datetime import date
from decimal import Decimal

import pytest
from django.apps import apps

from core.audit import AUDITED_DELETE_MODELS
from core.models import AdminActionLog
from examinations.models import Exam, ExamType, ExamSubject, StudentMark


@pytest.fixture
def exam_ctx(seed_data):
    school, year = seed_data['school_a'], seed_data['academic_year']
    student = seed_data['students'][0]
    exam_type = ExamType.objects.create(school=school, name='Final', weight=Decimal('100.00'))
    exam = Exam.objects.create(
        school=school, academic_year=year, exam_type=exam_type, class_obj=student.class_obj,
        name='Final Exam', status=Exam.Status.COMPLETED,
    )
    subject = ExamSubject.objects.create(
        school=school, exam=exam, subject=seed_data['subjects'][0],
        total_marks=Decimal('100.00'), passing_marks=Decimal('33.00'),
    )
    mark = StudentMark.objects.create(
        school=school, exam_subject=subject, student=student, marks_obtained=Decimal('80'),
    )
    return {**seed_data, 'exam': exam, 'exam_subject': subject, 'mark': mark, 'student': student}


def entries(**filters):
    return AdminActionLog.objects.filter(**filters)


def test_every_audited_model_label_resolves():
    for label in AUDITED_DELETE_MODELS:
        assert apps.get_model(label)


@pytest.mark.django_db
class TestSignalAudit:
    def test_deleting_an_exam_over_the_api_records_who_and_backs_up_its_marks(self, api, exam_ctx):
        exam = exam_ctx['exam']

        resp = api.client.delete(
            f'/api/examinations/exams/{exam.id}/',
            HTTP_AUTHORIZATION=f"Bearer {exam_ctx['tokens']['admin']}",
            HTTP_X_SCHOOL_ID=str(exam_ctx['SID_A']),
            HTTP_X_FORWARDED_FOR='203.0.113.9',
        )

        assert resp.status_code == 204, resp.content
        log = entries(action='hard_delete', target_type='Exam', target_id=str(exam.id)).get()
        assert log.actor == exam_ctx['users']['admin']
        assert log.ip_address == '203.0.113.9'
        assert log.school_id == exam_ctx['SID_A']
        backup = log.metadata['marks_backup']
        assert backup['student_marks_total'] == 1
        assert backup['student_marks'][0]['student_id'] == exam_ctx['student'].id
        assert Decimal(backup['student_marks'][0]['marks_obtained']) == Decimal('80')
        assert backup['exam_subjects'][0]['id'] == exam_ctx['exam_subject'].id
        assert not StudentMark.objects.filter(id=exam_ctx['mark'].id).exists()

    def test_rows_removed_by_cascade_are_covered_by_the_parent_entry(self, exam_ctx):
        exam_ctx['exam'].delete()

        assert entries(target_type='Exam').count() == 1
        assert not entries(target_type__in=['ExamSubject', 'StudentMark']).exists()

    def test_a_bulk_delete_writes_one_summary_entry_not_one_per_row(self, exam_ctx):
        school, student = exam_ctx['school_a'], exam_ctx['student']
        extra = [
            Exam.objects.create(
                school=school, academic_year=exam_ctx['academic_year'], exam_type=exam_ctx['exam'].exam_type,
                class_obj=student.class_obj, name=f'Test {i}', status=Exam.Status.COMPLETED,
            ) for i in range(3)
        ]

        Exam.objects.filter(id__in=[e.id for e in extra]).delete()

        log = entries(action='hard_delete_bulk', target_type='Exam').get()
        assert log.metadata['bulk'] is True
        assert log.metadata['count'] == 3
        assert set(log.metadata['ids_sample']) == {e.id for e in extra}

    def test_a_shell_style_delete_with_no_request_is_still_logged(self, exam_ctx):
        student = exam_ctx['student']
        student_id, name = student.id, student.name  # Django clears the pk on delete

        student.hard_delete()

        log = entries(action='hard_delete', target_type='Student', target_id=str(student_id)).get()
        assert log.actor is None
        assert log.metadata['snapshot']['name'] == name

    def test_deleting_an_expense_is_logged(self, seed_data):
        from finance.models import Expense, ExpenseCategory
        school = seed_data['school_a']
        category = ExpenseCategory.objects.create(school=school, name='Repairs')
        expense = Expense.objects.create(
            school=school, category=category, amount=Decimal('1500'), date=date(2026, 10, 1),
            description='Roof', recorded_by=seed_data['users']['admin'],
        )

        expense_id = expense.id  # Django clears the pk on delete
        expense.delete()

        log = entries(action='hard_delete', target_type='Expense', target_id=str(expense_id)).get()
        assert Decimal(log.metadata['snapshot']['amount']) == Decimal('1500')
