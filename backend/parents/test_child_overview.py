"""
Parent child-overview: year-scoped attendance, fee outstanding without double
counting carry-forward, published-only exam results, next exam, today's calendar
status, and the exam-results endpoints that used to return [] because they
ordered by a non-existent Exam.date. Builds on seed_data/seed_sections.
"""
from datetime import date, time
from decimal import Decimal

import pytest

from academic_sessions.models import SchoolCalendarEntry
from attendance.models import AttendanceRecord
from examinations.models import Exam, ExamSubject, ExamType, StudentMark
from academics.models import Subject
from finance.models import Account, FeePayment, MonthlyFeeCategory
from parents import overview as ov
from parents.models import ParentChild, ParentProfile
from users.models import User
from schools.models import UserSchoolMembership


pytestmark = pytest.mark.django_db

TODAY = date(2025, 10, 1)


def _parent(seed_data, name, *students):
    user = User.objects.create_user(
        username=f"{seed_data['prefix']}{name}", email=f"{name}@test.com", password=seed_data['password'],
        role='PARENT', school=seed_data['school_a'], organization=seed_data['org'],
    )
    UserSchoolMembership.objects.create(user=user, school=seed_data['school_a'], role='PARENT', is_default=True)
    profile = ParentProfile.objects.create(user=user, phone='0300')
    for student in students:
        ParentChild.objects.create(parent=profile, student=student, school=seed_data['school_a'], relation='FATHER')
    return user


@pytest.fixture
def child(seed_sections):
    return seed_sections['a_students'][0]


@pytest.fixture
def parent_token(seed_data, seed_sections, child, api):
    _parent(seed_data, 'pa', child)
    return api.login(f"{seed_data['prefix']}pa")


def _record(seed_data, student, day, status):
    return AttendanceRecord.objects.create(
        school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'], date=day, status=status,
    )


def _exam(seed_data, seed_sections, name, start, status, **extra):
    exam_type, _ = ExamType.objects.get_or_create(school=seed_data['school_a'], name='Term')
    return Exam.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'], exam_type=exam_type,
        class_obj=seed_sections['master'], name=name, start_date=start, status=status, **extra,
    )


def _paper(exam, subject, student=None, marks=None, total=100, exam_date=None, **extra):
    paper = ExamSubject.objects.create(
        school=exam.school, exam=exam, subject=subject, total_marks=total, passing_marks=40, exam_date=exam_date, **extra,
    )
    if student is not None:
        StudentMark.objects.create(
            school=exam.school, student=student, exam_subject=paper, marks_obtained=marks,
            is_absent=marks is None,
        )
    return paper


# ── attendance ──────────────────────────────────────────

def test_attendance_is_scoped_to_the_academic_year(seed_data, child):
    for day, status in ((date(2025, 9, 1), 'PRESENT'), (date(2025, 9, 2), 'PRESENT'),
                        (date(2025, 9, 3), 'PRESENT'), (date(2025, 9, 4), 'ABSENT')):
        _record(seed_data, child, day, status)
    # Last year's absence: before the seed academic year (starts 2025-04-01).
    _record(seed_data, child, date(2024, 9, 1), 'ABSENT')

    summary = ov.attendance_summary(child, seed_data['academic_year'].id, TODAY)

    assert (summary['total_days'], summary['present'], summary['absent']) == (4, 3, 1)
    assert summary['attendance_rate'] == 75.0


def test_attendance_reports_today_and_recent_days_oldest_first(seed_data, child):
    for day, status in ((date(2025, 9, 26), 'PRESENT'), (date(2025, 9, 27), 'ABSENT'), (date(2025, 9, 29), 'LATE')):
        _record(seed_data, child, day, status)
    _record(seed_data, child, TODAY, 'ABSENT')

    summary = ov.attendance_summary(child, seed_data['academic_year'].id, TODAY)

    assert summary['today'] == 'ABSENT'
    assert [r['date'] for r in summary['recent']] == sorted(r['date'] for r in summary['recent'])
    assert summary['recent'][-1] == {'date': '2025-10-01', 'status': 'ABSENT'}


def test_attendance_rate_is_none_without_records(seed_data, child):
    summary = ov.attendance_summary(child, seed_data['academic_year'].id, TODAY)

    assert summary['attendance_rate'] is None and summary['today'] is None and summary['recent'] == []


# ── fees ────────────────────────────────────────────────

def _fee(seed_data, student, month, year, due, paid, category=None, fee_type='MONTHLY', previous=0):
    extra = {}
    if Decimal(paid) > 0:  # FeePayment.clean() requires a date and an account for any payment
        account, _ = Account.objects.get_or_create(school=seed_data['school_a'], name='Cash', defaults={'account_type': 'CASH'})
        extra = {'payment_date': date(2026, month or 1, 5), 'account': account}
    return FeePayment.objects.create(
        school=seed_data['school_a'], student=student, month=month, year=year, fee_type=fee_type,
        monthly_category=category, amount_due=Decimal(due), amount_paid=Decimal(paid),
        previous_balance=Decimal(previous), academic_year=seed_data['academic_year'], **extra,
    )


def test_fee_outstanding_does_not_double_count_carried_forward_balance(seed_data, child):
    tuition = MonthlyFeeCategory.objects.create(school=seed_data['school_a'], name='Tuition')
    _fee(seed_data, child, 1, 2026, '1000', '0', tuition)
    # February's due already includes January's unpaid 1000.
    _fee(seed_data, child, 2, 2026, '2000', '500', tuition, previous='1000')

    summary = ov.fee_summary(child)

    assert summary['outstanding'] == '1500.00'   # not 3000 - 500
    assert summary['overdue_amount'] == '1000.00'
    assert summary['unpaid_items'] == 1


def test_fee_outstanding_adds_non_monthly_rows_and_separate_categories(seed_data, child):
    tuition = MonthlyFeeCategory.objects.create(school=seed_data['school_a'], name='Tuition')
    transport = MonthlyFeeCategory.objects.create(school=seed_data['school_a'], name='Transport')
    _fee(seed_data, child, 2, 2026, '1000', '1000', tuition)           # paid up
    _fee(seed_data, child, 2, 2026, '400', '100', transport)           # 300 owed
    _fee(seed_data, child, 0, 2026, '300', '100', None, fee_type='BOOKS')  # 200 owed

    summary = ov.fee_summary(child)

    assert summary['outstanding'] == '500.00'
    assert summary['unpaid_items'] == 2
    assert Decimal(summary['total_paid']) == Decimal('1200')
    assert Decimal(summary['total_due']) == Decimal('1700')   # paid + still owed, as staff see it


def test_fee_summary_for_a_child_with_no_fees(child):
    assert ov.fee_summary(child) == {
        'total_due': '0', 'outstanding': '0', 'overdue_amount': '0', 'unpaid_items': 0, 'total_paid': '0',
    }


# ── exams ───────────────────────────────────────────────

def test_latest_exams_are_published_only_and_average_the_subjects(seed_data, seed_sections, child):
    maths, urdu = seed_data['subjects']
    year_id = seed_data['academic_year'].id
    older = _exam(seed_data, seed_sections, 'Mid Term', date(2025, 8, 1), Exam.Status.PUBLISHED)
    newer = _exam(seed_data, seed_sections, 'Final', date(2025, 9, 15), Exam.Status.PUBLISHED)
    unreleased = _exam(seed_data, seed_sections, 'Draft', date(2025, 9, 25), Exam.Status.MARKS_ENTRY)
    _paper(older, maths, child, 50); _paper(older, urdu, child, 70)          # 60%
    _paper(newer, maths, child, 80); _paper(newer, urdu, child, 60)          # 70%
    _paper(newer, Subject.objects.create(school=seed_data['school_a'], name='Art', code='ART'), child, None)  # absent: ignored
    _paper(unreleased, maths, child, 10)                                     # must stay hidden

    latest, previous = ov.latest_exams(child, year_id)

    assert (latest['exam_name'], latest['percentage']) == ('Final', 70.0)
    assert (previous['exam_name'], previous['percentage']) == ('Mid Term', 60.0)


def test_latest_exams_are_none_without_published_results(seed_data, seed_sections, child):
    draft = _exam(seed_data, seed_sections, 'Draft', date(2025, 9, 25), Exam.Status.COMPLETED)
    _paper(draft, seed_data['subjects'][0], child, 90)

    assert ov.latest_exams(child, seed_data['academic_year'].id) == (None, None)


def test_next_exam_is_the_soonest_future_paper_of_a_published_schedule(seed_data, seed_sections, child):
    maths, urdu = seed_data['subjects']
    published = _exam(seed_data, seed_sections, 'Final', date(2025, 10, 5), Exam.Status.SCHEDULED,
                      schedule_published_at='2025-09-20T08:00:00Z')
    hidden = _exam(seed_data, seed_sections, 'Hidden', date(2025, 10, 2), Exam.Status.SCHEDULED)
    _paper(published, urdu, exam_date=date(2025, 10, 7), start_time=time(9, 0))
    _paper(published, maths, exam_date=date(2025, 10, 5), start_time=time(9, 0))
    art = Subject.objects.create(school=seed_data['school_a'], name='Art', code='ART2')
    _paper(published, art, exam_date=date(2025, 9, 1))       # already past
    _paper(hidden, maths, exam_date=date(2025, 10, 2))       # schedule not published

    result = ov.next_exam(child, seed_data['academic_year'].id, seed_sections['master'].id, TODAY)

    assert result == {'exam_name': 'Final', 'subject_name': maths.name, 'exam_date': '2025-10-05', 'start_time': '09:00:00'}


# ── today / leave ───────────────────────────────────────

def test_today_status_reports_a_school_holiday(seed_data, seed_sections):
    master_id, school_id = seed_sections['master'].id, seed_data['SID_A']
    assert ov.today_status(school_id, master_id, TODAY) == {
        'date': '2025-10-01', 'is_off_day': False, 'off_day_types': [],
    }
    SchoolCalendarEntry.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'], name='Holiday',
        entry_kind='OFF_DAY', off_day_type='NATIONAL_HOLIDAY', scope='SCHOOL',
        start_date=TODAY, end_date=TODAY,
    )

    status = ov.today_status(school_id, master_id, TODAY)

    assert status['is_off_day'] is True and status['off_day_types'] == ['NATIONAL_HOLIDAY']


# ── endpoints ───────────────────────────────────────────

def test_overview_endpoint_returns_the_documented_shape(seed_data, child, parent_token, api):
    response = api.get(f'/api/parents/children/{child.id}/overview/', parent_token, seed_data['SID_A'])

    assert response.status_code == 200, response.content[:300]
    body = response.json()
    assert {'attendance_summary', 'fee_summary', 'latest_exam', 'previous_exam', 'next_exam',
            'today', 'pending_leave_count'} <= set(body)
    assert {'attendance_rate', 'today', 'recent'} <= set(body['attendance_summary'])
    assert {'outstanding', 'overdue_amount', 'unpaid_items'} <= set(body['fee_summary'])
    assert body['pending_leave_count'] == 0


def test_a_parent_cannot_read_another_parents_child(seed_data, seed_sections, child, parent_token, api):
    stranger = seed_sections['b_students'][0]

    response = api.get(f'/api/parents/children/{stranger.id}/overview/', parent_token, seed_data['SID_A'])

    assert response.status_code == 403


def test_results_endpoint_returns_published_exams(seed_data, seed_sections, child, parent_token, api):
    exam = _exam(seed_data, seed_sections, 'Final', date(2025, 9, 15), Exam.Status.PUBLISHED)
    _paper(exam, seed_data['subjects'][0], child, 80)
    draft = _exam(seed_data, seed_sections, 'Draft', date(2025, 9, 25), Exam.Status.COMPLETED)
    _paper(draft, seed_data['subjects'][0], child, 10)

    response = api.get(f'/api/parents/children/{child.id}/exam-results/', parent_token, seed_data['SID_A'])

    assert response.status_code == 200
    body = response.json()
    assert [e['exam_name'] for e in body] == ['Final']
    assert body[0]['exam_date'] == '2025-09-15'
    assert body[0]['subjects'][0]['marks_obtained'] == 80.0


def test_staff_student_profile_exam_results_are_no_longer_empty(seed_data, seed_sections, child, api):
    exam = _exam(seed_data, seed_sections, 'Final', date(2025, 9, 15), Exam.Status.PUBLISHED)
    _paper(exam, seed_data['subjects'][0], child, 80)

    response = api.get(f'/api/students/{child.id}/exam_results/', seed_data['tokens']['admin'], seed_data['SID_A'])

    assert response.status_code == 200, response.content[:300]
    assert [e['exam_name'] for e in response.json()] == ['Final']
