"""A soft-deleted student must drop out of every place a roster is built or a record
is created: the attendance register, monthly fee generation, and marks entry. Their
old records stay in the database, but nothing new can be written for them."""
from datetime import date
from decimal import Decimal

import pytest

from academic_sessions.models import StudentEnrollment
from attendance.models import AttendanceRecord
from examinations.models import Exam, ExamSubject, ExamType, StudentMark
from finance.models import FeePayment, FeeStructure, MonthlyFeeCategory
from finance.tasks import generate_monthly_fees_task


@pytest.fixture
def roster(seed_data):
    """Three students of one class, all enrolled this year; the first is soft-deleted."""
    school, year = seed_data['school_a'], seed_data['academic_year']
    students = seed_data['students'][:3]
    class_obj = students[0].class_obj
    for student in students:
        student.class_obj = class_obj
        student.save(update_fields=['class_obj'])
        StudentEnrollment.objects.get_or_create(
            school=school, student=student, academic_year=year,
            defaults={'class_obj': class_obj, 'roll_number': student.roll_number, 'status': 'ACTIVE'},
        )
    deleted, *kept = students
    deleted.soft_delete()
    return {**seed_data, 'deleted': deleted, 'kept': kept, 'class_obj': class_obj, 'year': year}


def get(api, ctx, url):
    return api.get(url, ctx['tokens']['admin'], ctx['SID_A'])


@pytest.mark.django_db
class TestAttendanceMarking:
    def test_register_roster_does_not_list_the_deleted_student(self, api, roster):
        day = roster['year'].start_date

        resp = get(api, roster, (
            f"/api/sessions/enrollments/?academic_year={roster['year'].id}"
            f"&class_id={roster['class_obj'].id}&active_on={day}&page_size=500"
        ))

        assert resp.status_code == 200, resp.content
        body = resp.json()
        listed = {row['student'] for row in (body['results'] if isinstance(body, dict) else body)}
        assert roster['deleted'].id not in listed
        assert {s.id for s in roster['kept']} <= listed

    def test_saving_attendance_for_the_deleted_student_is_refused(self, api, roster):
        day = roster['year'].start_date
        payload = {
            'class_id': roster['class_obj'].id,
            'academic_year': roster['year'].id,
            'date': str(day),
            'entries': [
                {'student_id': roster['deleted'].id, 'status': 'ABSENT'},
                {'student_id': roster['kept'][0].id, 'status': 'PRESENT'},
            ],
        }

        resp = api.post('/api/attendance/records/bulk_entry/', payload, roster['tokens']['admin'], roster['SID_A'])

        assert resp.status_code == 200, resp.content
        assert [e['student_id'] for e in resp.json()['errors']] == [roster['deleted'].id]
        assert not AttendanceRecord.objects.filter(student_id=roster['deleted'].id, date=day).exists()
        assert AttendanceRecord.objects.filter(student_id=roster['kept'][0].id, date=day).exists()


@pytest.mark.django_db
class TestFeeGeneration:
    @pytest.fixture
    def fees(self, roster):
        school = roster['school_a']
        category = MonthlyFeeCategory.objects.create(school=school, name='School Fee', is_active=True)
        FeeStructure.objects.create(
            school=school, class_obj=roster['class_obj'], fee_type='MONTHLY',
            monthly_category=category, monthly_amount=Decimal('1000'), effective_from=date(2020, 1, 1),
        )
        return {**roster, 'category': category}

    def test_monthly_generation_bills_only_the_visible_students(self, fees):
        year = fees['year']

        result = generate_monthly_fees_task.apply(kwargs={
            'school_id': fees['school_a'].id, 'month': year.start_date.month, 'year': year.start_date.year,
            'class_id': fees['class_obj'].id, 'academic_year_id': year.id,
            'monthly_category_ids': [fees['category'].id],
        }).get()

        assert result['created'] == len(fees['kept'])
        assert not FeePayment.objects.filter(student_id=fees['deleted'].id).exists()
        assert FeePayment.objects.filter(student_id=fees['kept'][0].id).exists()

    def test_a_single_fee_for_the_deleted_student_is_refused(self, api, fees):
        year = fees['year']

        resp = api.post('/api/finance/fee-payments/generate_single/', {
            'student': fees['deleted'].id, 'fee_type': 'MONTHLY', 'year': year.start_date.year,
            'month': year.start_date.month, 'monthly_category': fees['category'].id,
        }, fees['tokens']['admin'], fees['SID_A'])

        assert resp.status_code == 404, resp.content
        assert not FeePayment.objects.filter(student_id=fees['deleted'].id).exists()


@pytest.mark.django_db
class TestMarksEntry:
    @pytest.fixture
    def exam(self, roster):
        school = roster['school_a']
        exam = Exam.objects.create(
            school=school, academic_year=roster['year'],
            exam_type=ExamType.objects.create(school=school, name='Final', weight=Decimal('100.00')),
            class_obj=roster['class_obj'], name='Final Exam', status=Exam.Status.COMPLETED,
        )
        subject = ExamSubject.objects.create(
            school=school, exam=exam, subject=roster['subjects'][0],
            total_marks=Decimal('100.00'), passing_marks=Decimal('33.00'),
        )
        return {**roster, 'exam': exam, 'exam_subject': subject}

    def test_marks_roster_does_not_list_the_deleted_student(self, api, exam):
        resp = get(api, exam, (
            f"/api/students/?class_id={exam['class_obj'].id}&academic_year={exam['year'].id}"
            '&is_active=true&page_size=9999'
        ))

        assert resp.status_code == 200, resp.content
        body = resp.json()
        listed = {row['id'] for row in (body['results'] if isinstance(body, dict) else body)}
        assert exam['deleted'].id not in listed
        assert {s.id for s in exam['kept']} <= listed

    def test_saving_marks_for_the_deleted_student_is_refused(self, api, exam):
        payload = {
            'exam_subject_id': exam['exam_subject'].id,
            'marks': [
                {'student_id': exam['deleted'].id, 'marks_obtained': 90},
                {'student_id': exam['kept'][0].id, 'marks_obtained': 70},
            ],
        }

        resp = api.post('/api/examinations/marks/bulk_entry/', payload, exam['tokens']['admin'], exam['SID_A'])

        assert resp.status_code == 200, resp.content
        assert [e['student_id'] for e in resp.json()['errors']] == [exam['deleted'].id]
        assert not StudentMark.objects.filter(student_id=exam['deleted'].id).exists()
        assert StudentMark.objects.filter(student_id=exam['kept'][0].id, marks_obtained=70).exists()
