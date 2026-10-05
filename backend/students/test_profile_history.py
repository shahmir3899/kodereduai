"""The student profile for a transferred student: every tab reads old plus new, live.

Setup used throughout (the exit leaves on 2026-03-01):
    old record at School Alpha  -> attendance, exams, fees, documents, remarks up to 1 Mar
    new record at School Beta   -> attendance, exams, a carried fee row from 1 Mar
Requests are made as School Beta's admin (the new branch), on the NEW record.
"""
from datetime import date
from decimal import Decimal

import pytest

from academic_sessions.models import StudentEnrollment
from academics.models import Subject
from attendance.models import AttendanceRecord
from examinations.models import Exam, ExamSubject, ExamType, GradeScale, StudentMark, StudentTermAssessment
from finance.models import Account, FeePayment, MonthlyFeeCategory
from student_exits.models import EnrollmentBreak, StudentExit
from students.models import Student, StudentDocument
from students.test_timeline import LEAVING, ctx, link  # noqa: F401  (ctx is the fixture)

URL = '/api/students/'


@pytest.fixture
def pair(ctx):
    """The old record at Alpha and its transferred-in record at Beta, both enrolled."""
    old = ctx['old']
    new = link(ctx, old, ctx['school_b'])
    StudentEnrollment.objects.create(
        school=ctx['school_a'], student=old, academic_year=ctx['academic_year'], class_obj=old.class_obj,
        roll_number=old.roll_number, status='TRANSFERRED', is_active=False, left_date=LEAVING,
    )
    StudentEnrollment.objects.create(
        school=ctx['school_b'], student=new, academic_year=ctx['place']['year'],
        class_obj=ctx['place']['master'], session_class=ctx['place']['session_class'],
        roll_number=new.roll_number, status='ACTIVE',
    )
    return {**ctx, 'new': new}


def get(api, pair, path, *, student=None, who='admin_b', school='SID_B'):
    student = student or pair['new']
    resp = api.get(f'{URL}{student.id}/{path}', pair['tokens'][who], pair[school])
    assert resp.status_code == 200, resp.content
    return resp.json()


def day(api_pair, student, school, year, when, status='PRESENT'):
    return AttendanceRecord.objects.create(school=school, academic_year=year, student=student, date=when, status=status)


def old_days(pair, *entries):
    for when, status in entries:
        day(None, pair['old'], pair['school_a'], pair['academic_year'], when, status)


def new_days(pair, *entries):
    for when, status in entries:
        day(None, pair['new'], pair['school_b'], pair['place']['year'], when, status)


def add_exam(pair, student, school, year, subject, when, marks, total=100):
    exam_type, _ = ExamType.objects.get_or_create(school=school, name='PYTEST_Type')
    exam = Exam.objects.create(
        school=school, academic_year=year, exam_type=exam_type, class_obj=student.class_obj,
        name=f'PYTEST_{school.id}_{when}', start_date=when, status='COMPLETED',
    )
    es = ExamSubject.objects.create(school=school, exam=exam, subject=subject, total_marks=total, passing_marks=total * 0.4)
    StudentMark.objects.create(school=school, exam_subject=es, student=student, marks_obtained=marks)
    return exam


def subjects(pair):
    return (
        Subject.objects.filter(school=pair['school_a']).first(),
        Subject.objects.create(school=pair['school_b'], name='PYTEST_Math_B', code='PMB'),
    )


# ── Overview numbers ─────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestProfileSummary:
    def test_attendance_covers_both_branches_and_never_counts_a_day_twice(self, api, pair):
        old_days(pair, (date(2026, 2, 2), 'PRESENT'), (date(2026, 2, 3), 'PRESENT'), (date(2026, 2, 4), 'ABSENT'),
                 (date(2026, 3, 1), 'ABSENT'),          # the leaving day is Beta's
                 (date(2026, 3, 5), 'ABSENT'))          # recorded at Alpha after leaving: never shown
        new_days(pair, (date(2026, 3, 1), 'PRESENT'), (date(2026, 3, 2), 'LEAVE'), (date(2026, 3, 3), 'ABSENT'))
        body = get(api, pair, 'profile_summary/')
        # old: 2 present + 1 absent; new: 1 present + 1 leave + 1 absent -> 3 present(+leave), 2 absent of 6
        assert (body['total_days'], body['present_days'], body['total_absent'], body['total_leave']) == (6, 4, 2, 1)
        assert body['attendance_rate'] == round(4 / 6 * 100, 1)

    def test_it_says_which_branches_the_data_came_from(self, api, pair):
        body = get(api, pair, 'profile_summary/')
        assert body['has_earlier_branch_data'] is True
        assert body['earlier_branches'] == [pair['school_a'].name]

    def test_an_ordinary_student_is_unchanged(self, api, pair):
        stranger = pair['students'][1]
        day(None, stranger, pair['school_a'], pair['academic_year'], date(2026, 2, 2))
        body = get(api, pair, 'profile_summary/', student=stranger, who='admin', school='SID_A')
        assert body['has_earlier_branch_data'] is False and body['earlier_branches'] == []
        assert body['total_days'] == 1

    def test_the_old_record_never_sees_the_new_branchs_days(self, api, pair):
        old_days(pair, (date(2026, 2, 2), 'PRESENT'))
        new_days(pair, (date(2026, 3, 2), 'PRESENT'), (date(2026, 3, 3), 'PRESENT'))
        body = get(api, pair, 'profile_summary/', student=pair['old'], who='admin', school='SID_A')
        assert body['total_days'] == 1 and body['has_earlier_branch_data'] is False

    def test_fees_count_what_was_paid_at_both_branches_but_owe_only_at_the_new_one(self, api, pair):
        account = Account.objects.create(school=pair['school_a'], name='Cash', account_type='CASH')
        cat_a = MonthlyFeeCategory.objects.create(school=pair['school_a'], name='Tuition')
        cat_b = MonthlyFeeCategory.objects.create(school=pair['school_b'], name='Tuition')
        FeePayment.objects.create(                         # paid in full at Alpha
            school=pair['school_a'], academic_year=pair['academic_year'], student=pair['old'], fee_type='MONTHLY',
            monthly_category=cat_a, month=1, year=2026, amount_due=Decimal('1000'), amount_paid=Decimal('1000'),
            status='PAID', payment_date=date(2026, 1, 5), account=account,
        )
        FeePayment.objects.create(                         # the balance carried to Beta, unpaid
            school=pair['school_b'], academic_year=pair['place']['year'], student=pair['new'], fee_type='MONTHLY',
            monthly_category=cat_b, month=2, year=2026, amount_due=Decimal('1500'), previous_balance=Decimal('1500'),
            amount_paid=Decimal('0'), status='UNPAID',
        )
        body = get(api, pair, 'profile_summary/')
        assert (body['total_paid'], body['outstanding']) == (1000.0, 1500.0)
        assert body['total_due'] == body['total_paid'] + body['outstanding'] == 2500.0

    def test_the_exam_average_is_the_most_recent_exam_across_both_branches(self, api, pair):
        a, b = subjects(pair)
        add_exam(pair, pair['old'], pair['school_a'], pair['academic_year'], a, date(2026, 2, 10), 60)
        body = get(api, pair, 'profile_summary/')
        assert body['exam_average'] == 60.0                      # only an old exam so far: it counts
        add_exam(pair, pair['new'], pair['school_b'], pair['place']['year'], b, date(2026, 3, 20), 80)
        body = get(api, pair, 'profile_summary/')
        assert body['exam_average'] == 80.0 and body['exam_average_label'].startswith('PYTEST_')

    def test_an_old_exam_from_before_this_academic_year_does_not_count(self, api, pair):
        a, _ = subjects(pair)
        add_exam(pair, pair['old'], pair['school_a'], pair['academic_year'], a, date(2025, 1, 10), 90)  # year starts 2025-04-01
        assert get(api, pair, 'profile_summary/')['exam_average'] is None

    def test_one_audit_line_is_written_per_profile_open(self, api, pair, monkeypatch):
        calls = []
        monkeypatch.setattr('core.audit.log_admin_action', lambda *a, **k: calls.append(a))
        get(api, pair, 'profile_summary/')
        assert len(calls) == 1 and calls[0][1] == 'cross_branch_read'
        calls.clear()
        get(api, pair, 'attendance_history/')               # other tabs do not each log
        assert calls == []


# ── Tabs ─────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestAttendanceTab:
    def test_months_from_both_branches_are_tagged_and_ordered(self, api, pair):
        old_days(pair, (date(2026, 1, 12), 'PRESENT'), (date(2026, 2, 3), 'ABSENT'), (date(2026, 2, 27), 'PRESENT'))
        new_days(pair, (date(2026, 3, 2), 'PRESENT'), (date(2026, 3, 3), 'LEAVE'))
        months = get(api, pair, 'attendance_history/')['months']
        assert [m['month'] for m in months] == ['March 2026', 'February 2026', 'January 2026']
        assert months[0]['branch'] is None and months[0]['read_only'] is False
        assert months[1]['branch'] == pair['school_a'].name and months[1]['read_only'] is True
        assert months[0]['rate'] == 100.0                      # leave counts as present

    def test_a_month_spanning_the_transfer_has_one_row_per_branch(self, api, pair):
        StudentExit.objects.filter(destination_student=pair['new']).update(leaving_date=date(2026, 3, 15))
        old_days(pair, (date(2026, 3, 3), 'PRESENT'), (date(2026, 3, 10), 'ABSENT'),
                 (date(2026, 3, 20), 'ABSENT'))                 # after leaving: not shown
        new_days(pair, (date(2026, 3, 16), 'PRESENT'))
        march = [m for m in get(api, pair, 'attendance_history/')['months'] if m['month'] == 'March 2026']
        assert len(march) == 2
        by_branch = {m['branch']: m for m in march}
        assert by_branch[pair['school_a'].name]['total'] == 2 and by_branch[None]['total'] == 1

    def test_no_records_after_the_leaving_date_leak_in_from_the_old_branch(self, api, pair):
        old_days(pair, (date(2026, 3, 9), 'PRESENT'))
        assert get(api, pair, 'attendance_history/')['months'] == []

    def test_an_ordinary_student_has_untagged_rows(self, api, pair):
        stranger = pair['students'][1]
        day(None, stranger, pair['school_a'], pair['academic_year'], date(2026, 2, 2))
        rows = get(api, pair, 'attendance_history/', student=stranger, who='admin', school='SID_A')['months']
        assert len(rows) == 1 and rows[0]['branch'] is None and rows[0]['read_only'] is False


@pytest.mark.django_db
class TestFeesTab:
    def test_both_ledgers_with_handed_over_and_carried_rows_marked(self, api, pair):
        cat_a = MonthlyFeeCategory.objects.create(school=pair['school_a'], name='Tuition')
        cat_b = MonthlyFeeCategory.objects.create(school=pair['school_b'], name='Tuition')
        exit_case = StudentExit.objects.get(destination_student=pair['new'])
        FeePayment.objects.create(
            school=pair['school_a'], academic_year=pair['academic_year'], student=pair['old'], fee_type='MONTHLY',
            monthly_category=cat_a, month=2, year=2026, amount_due=Decimal('1500'), amount_paid=Decimal('0'),
            status='UNPAID', handed_over_to_exit=exit_case,
        )
        FeePayment.objects.create(
            school=pair['school_b'], academic_year=pair['place']['year'], student=pair['new'], fee_type='MONTHLY',
            monthly_category=cat_b, month=2, year=2026, amount_due=Decimal('1500'), amount_paid=Decimal('0'),
            status='UNPAID', carried_from_exit=exit_case,
        )
        rows = get(api, pair, 'fee_ledger/')
        assert len(rows) == 2
        old_row = next(r for r in rows if r['branch'])
        new_row = next(r for r in rows if not r['branch'])
        assert old_row['read_only'] and old_row['handed_over'] and not old_row['carried']
        assert new_row['carried'] and not new_row['read_only']


@pytest.mark.django_db
class TestAcademicsTab:
    def test_exams_of_both_branches_with_each_branchs_own_grade_scale(self, api, pair):
        a, b = subjects(pair)
        GradeScale.objects.create(school=pair['school_a'], grade_label='A-OLD', min_percentage=50, max_percentage=100)
        GradeScale.objects.create(school=pair['school_b'], grade_label='B-NEW', min_percentage=50, max_percentage=100)
        add_exam(pair, pair['old'], pair['school_a'], pair['academic_year'], a, date(2026, 2, 10), 70)
        add_exam(pair, pair['new'], pair['school_b'], pair['place']['year'], b, date(2026, 3, 20), 90)
        exams = get(api, pair, 'exam_results/')
        assert [e['exam_date'] for e in exams] == ['2026-03-20', '2026-02-10']
        new_exam, old_exam = exams
        assert new_exam['branch'] is None and new_exam['subjects'][0]['grade'] == 'B-NEW'
        assert old_exam['branch'] == pair['school_a'].name and old_exam['read_only'] is True
        assert old_exam['subjects'][0]['grade'] == 'A-OLD'

    def test_an_old_exam_after_the_leaving_date_is_not_shown(self, api, pair):
        a, _ = subjects(pair)
        add_exam(pair, pair['old'], pair['school_a'], pair['academic_year'], a, date(2026, 4, 1), 50)
        assert get(api, pair, 'exam_results/') == []


@pytest.mark.django_db
class TestHistoryAndDocuments:
    def test_enrollments_of_both_branches_are_listed_and_tagged(self, api, pair):
        rows = get(api, pair, 'enrollment_history/')
        assert len(rows) == 2
        assert {r['branch'] for r in rows} == {None, pair['school_a'].name}
        old_row = next(r for r in rows if r['branch'])
        assert old_row['status'] == 'TRANSFERRED' and old_row['left_date'] == '2026-03-01'

    def test_the_days_before_joining_are_marked_as_joined_from_a_transfer_not_away(self, api, pair):
        exit_case = StudentExit.objects.get(destination_student=pair['new'])
        EnrollmentBreak.objects.create(
            school=pair['school_b'], student=pair['new'], exit=exit_case,
            start_date=pair['place']['year'].start_date, end_date=LEAVING, reason='Joined from Alpha',
        )
        rows = get(api, pair, 'away_periods/')
        assert [r['joined_from_transfer'] for r in rows] == [True]

    def test_a_real_return_after_leaving_is_still_away(self, api, pair):
        EnrollmentBreak.objects.create(
            school=pair['school_b'], student=pair['new'], start_date=date(2026, 5, 1), end_date=date(2026, 5, 9),
        )
        assert [r['joined_from_transfer'] for r in get(api, pair, 'away_periods/')] == [False]

    def test_documents_of_the_old_branch_are_listed_but_cannot_be_deleted_from_here(self, api, pair):
        old_doc = StudentDocument.objects.create(
            school=pair['school_a'], student=pair['old'], document_type='BIRTH_CERT', title='Birth certificate', file_url='https://x/y',
        )
        new_doc = StudentDocument.objects.create(
            school=pair['school_b'], student=pair['new'], document_type='OTHER', title='Form', file_url='https://x/z',
        )
        docs = get(api, pair, 'documents/')
        assert {d['title']: d['read_only'] for d in docs} == {'Birth certificate': True, 'Form': False}
        resp = api.client.delete(
            f"{URL}{pair['new'].id}/documents/{old_doc.id}/", HTTP_AUTHORIZATION=f"Bearer {pair['tokens']['admin_b']}",
            HTTP_X_SCHOOL_ID=str(pair['SID_B']))
        assert resp.status_code == 404 and StudentDocument.objects.filter(pk=old_doc.pk).exists()
        assert StudentDocument.objects.filter(pk=new_doc.pk).exists()

    def test_the_old_record_cannot_be_edited_from_the_new_branch(self, api, pair):
        resp = api.patch(f"{URL}{pair['old'].id}/", {'name': 'Changed'}, pair['tokens']['admin_b'], pair['SID_B'])
        assert resp.status_code in (403, 404)
        pair['old'].refresh_from_db()
        assert pair['old'].name != 'Changed'


@pytest.mark.django_db
class TestEarlierAssessments:
    def test_remarks_and_ratings_from_the_old_branch_are_listed_read_only(self, api, pair):
        StudentTermAssessment.objects.create(
            school=pair['school_a'], student=pair['old'], academic_year=pair['academic_year'], month=2,
            listening=4, teacher_remark='Keen learner', principal_remark='Well done',
        )
        StudentTermAssessment.objects.create(          # the new branch's own: not part of "earlier"
            school=pair['school_b'], student=pair['new'], academic_year=pair['place']['year'], month=3,
            teacher_remark='New branch remark',
        )
        rows = get(api, pair, 'earlier_assessments/')
        assert len(rows) == 1
        assert rows[0]['teacher_remark'] == 'Keen learner' and rows[0]['ratings']['listening'] == 4
        assert rows[0]['branch'] == pair['school_a'].name and rows[0]['read_only'] is True

    def test_a_student_with_no_history_has_none(self, api, pair):
        stranger = pair['students'][1]
        assert get(api, pair, 'earlier_assessments/', student=stranger, who='admin', school='SID_A') == []
