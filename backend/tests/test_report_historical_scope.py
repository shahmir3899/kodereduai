from datetime import date
from decimal import Decimal

import pytest

from academic_sessions.models import AcademicYear, StudentEnrollment
from attendance.models import AttendanceRecord
from examinations.models import Exam, ExamSubject, ExamType, StudentMark
from finance.models import Account
from finance.models import FeePayment
from reports.generators.academic import ClassResultReportGenerator, StudentProgressReportGenerator
from reports.generators.attendance import DailyAttendanceReportGenerator
from reports.generators.fee import FeeCollectionReportGenerator, FeeDefaultersReportGenerator
from reports.generators.student import StudentComprehensiveReportGenerator


pytestmark = [pytest.mark.django_db]


@pytest.fixture
def historical_scope_setup(seed_data):
    school = seed_data['school_a']
    source_year = seed_data['academic_year']
    class_old = seed_data['classes'][0]
    class_new = seed_data['classes'][1]
    student = seed_data['students'][0]

    target_year = AcademicYear.objects.create(
        school=school,
        name=f"{seed_data['prefix']}2026-2027-reports",
        start_date=date(2026, 4, 1),
        end_date=date(2027, 3, 31),
        is_current=False,
        is_active=True,
    )

    source_enrollment, _ = StudentEnrollment.objects.get_or_create(
        school=school,
        student=student,
        academic_year=source_year,
        defaults={
            'class_obj': class_old,
            'roll_number': '7',
            'status': StudentEnrollment.Status.ACTIVE,
            'is_active': True,
        },
    )
    source_enrollment.class_obj = class_old
    source_enrollment.roll_number = '7'
    source_enrollment.is_active = True
    source_enrollment.status = StudentEnrollment.Status.ACTIVE
    source_enrollment.save(update_fields=['class_obj', 'roll_number', 'is_active', 'status', 'updated_at'])

    StudentEnrollment.objects.get_or_create(
        school=school,
        student=student,
        academic_year=target_year,
        defaults={
            'class_obj': class_new,
            'roll_number': '21',
            'status': StudentEnrollment.Status.ACTIVE,
            'is_active': True,
        },
    )

    # Snapshot class/roll intentionally moved away from historical enrollment.
    student.class_obj = class_new
    student.roll_number = '21'
    student.save(update_fields=['class_obj', 'roll_number', 'updated_at'])

    test_date = date(2025, 6, 22)
    AttendanceRecord.objects.create(
        school=school,
        student=student,
        date=test_date,
        academic_year=source_year,
        status='PRESENT',
        source='MANUAL',
    )

    fee_account = Account.objects.create(
        school=school,
        name=f"{seed_data['prefix']}Fee Account",
        account_type=Account.AccountType.CASH,
        opening_balance=Decimal('0'),
        is_active=True,
    )

    FeePayment.objects.update_or_create(
        school=school,
        student=student,
        month=6,
        year=2025,
        fee_type='MONTHLY',
        defaults={
            'academic_year': source_year,
            'amount_due': Decimal('1500'),
            'amount_paid': Decimal('500'),
            'payment_date': test_date,
            'account': fee_account,
            'status': FeePayment.PaymentStatus.PARTIAL,
        },
    )

    exam_type = ExamType.objects.create(
        school=school,
        name=f"{seed_data['prefix']}Midterm Reports",
        weight=Decimal('100.00'),
        is_active=True,
    )
    exam = Exam.objects.create(
        school=school,
        academic_year=source_year,
        exam_type=exam_type,
        class_obj=class_old,
        name=f"{seed_data['prefix']}Midterm",
        start_date=test_date,
        end_date=test_date,
        status=Exam.Status.PUBLISHED,
        is_active=True,
    )
    exam_subject = ExamSubject.objects.create(
        school=school,
        exam=exam,
        subject=seed_data['subjects'][0],
        total_marks=Decimal('100.00'),
        passing_marks=Decimal('40.00'),
        is_active=True,
    )
    StudentMark.objects.update_or_create(
        school=school,
        exam_subject=exam_subject,
        student=student,
        defaults={
            'enrollment': source_enrollment,
            'marks_obtained': Decimal('82.00'),
            'is_absent': False,
        },
    )

    return {
        'school': school,
        'student': student,
        'source_year': source_year,
        'class_old': class_old,
        'class_new': class_new,
        'test_date': test_date,
        'exam': exam,
    }


def test_attendance_daily_report_uses_historical_class_and_roll(historical_scope_setup):
    school = historical_scope_setup['school']
    source_year = historical_scope_setup['source_year']
    class_old = historical_scope_setup['class_old']
    test_date = historical_scope_setup['test_date']

    data = DailyAttendanceReportGenerator(school, {
        'date': str(test_date),
        'class_id': class_old.id,
        'academic_year': source_year.id,
    }).get_data()

    assert data['table_rows'], 'Expected attendance rows for historical scope'
    row = data['table_rows'][0]
    assert row[0] == class_old.name
    assert str(row[1]) == '7'


def test_fee_reports_use_historical_class_and_roll(historical_scope_setup):
    school = historical_scope_setup['school']
    source_year = historical_scope_setup['source_year']
    class_old = historical_scope_setup['class_old']

    collection = FeeCollectionReportGenerator(school, {
        'month': 6,
        'year': 2025,
        'academic_year': source_year.id,
    }).get_data()
    assert collection['table_rows'], 'Expected fee collection rows for historical scope'
    assert collection['table_rows'][0][0] == class_old.name

    defaulters = FeeDefaultersReportGenerator(school, {
        'month': 6,
        'year': 2025,
        'academic_year': source_year.id,
    }).get_data()
    assert defaulters['table_rows'], 'Expected defaulters rows for historical scope'
    assert defaulters['table_rows'][0][0] == class_old.name
    assert str(defaulters['table_rows'][0][1]) == '7'


def test_academic_reports_use_historical_class_and_roll(historical_scope_setup):
    school = historical_scope_setup['school']
    source_year = historical_scope_setup['source_year']
    exam = historical_scope_setup['exam']
    student = historical_scope_setup['student']
    class_old = historical_scope_setup['class_old']

    class_result = ClassResultReportGenerator(school, {
        'exam_id': exam.id,
        'academic_year': source_year.id,
    }).get_data()
    assert class_result['table_rows'], 'Expected class result rows for historical scope'
    assert class_result['table_rows'][0][0] == class_old.name
    assert str(class_result['table_rows'][0][1]) == '7'

    progress = StudentProgressReportGenerator(school, {
        'student_id': student.id,
        'academic_year': source_year.id,
    }).get_data()
    assert progress['summary']['Class'] == class_old.name
    assert str(progress['summary']['Roll Number']) == '7'


def test_student_comprehensive_uses_historical_summary_class_and_roll(historical_scope_setup):
    school = historical_scope_setup['school']
    source_year = historical_scope_setup['source_year']
    student = historical_scope_setup['student']
    class_old = historical_scope_setup['class_old']

    data = StudentComprehensiveReportGenerator(school, {
        'student_id': student.id,
        'academic_year': source_year.id,
    }).get_data()

    assert data['summary']['Class'] == class_old.name
    assert str(data['summary']['Roll Number']) == '7'
