"""One definition of student risk, shared by the profile and the Student Risk Score page.

The key guarantee: for the same student, StudentRiskScoreService.score_student() (the
profile) and get_student_risk_scores() (the school-wide page) give the same score.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from academic_sessions.attendance_risk_service import AttendanceRiskService
from academic_sessions.models import StudentEnrollment
from academic_sessions.student_risk_score_service import (
    StudentRiskScoreService, combine, worse,
)
from attendance.models import AttendanceRecord
from finance.fee_risk import fee_risk_for_students
from finance.models import Account, FeePayment, MonthlyFeeCategory


@pytest.fixture
def ctx(seed_data):
    student = seed_data['students'][0]
    StudentEnrollment.objects.get_or_create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'], student=student,
        defaults={'class_obj': seed_data['classes'][0], 'roll_number': student.roll_number},
    )
    category = MonthlyFeeCategory.objects.create(school=seed_data['school_a'], name='Tuition')
    return {**seed_data, 'student': student, 'category': category}


def mark_days(ctx, statuses, start=date(2025, 5, 5)):
    """One attendance record per school day (Sundays skipped) with the given statuses."""
    day = start
    for status in statuses:
        while day.weekday() == 6:
            day += timedelta(days=1)
        AttendanceRecord.objects.get_or_create(
            student=ctx['student'], date=day,
            defaults={'school': ctx['school_a'], 'academic_year': ctx['academic_year'],
                      'status': status, 'source': 'MANUAL'},
        )
        day += timedelta(days=1)


def bill(ctx, month, due, prev, base='1000', paid='0', **extra):
    return FeePayment.objects.create(
        school=ctx['school_a'], academic_year=ctx['academic_year'], student=ctx['student'],
        fee_type='MONTHLY', monthly_category=ctx['category'], month=month, year=2026,
        amount_due=Decimal(due), previous_balance=Decimal(prev), base_monthly_fee=Decimal(base),
        amount_paid=Decimal(paid), status='UNPAID', **extra,
    )


def attendance_entry(ctx, **kw):
    report = AttendanceRiskService(ctx['SID_A'], ctx['academic_year'].id).get_at_risk_students(
        only_student_ids=[ctx['student'].id], include_unflagged=True, **kw)
    return next(s for s in report['students'] if s['student_id'] == ctx['student'].id)


class TestCombine:
    def test_nothing_flagged_scores_ten_not_thirty_three(self):
        assert combine(None, None, None) == (10.0, 'LOW')

    def test_everything_high_is_ninety(self):
        assert combine('HIGH', 'HIGH', 'HIGH') == (90.0, 'HIGH')

    def test_weights_are_35_35_30(self):
        assert combine('HIGH', None, None)[0] == round(90 * .35 + 10 * .35 + 10 * .30, 1)

    def test_without_fees_the_other_two_are_renormalised(self):
        assert combine('HIGH', 'HIGH', None, include_fees=False)[0] == round((90 * .35 + 10 * .30) / .65, 1)

    def test_the_fee_argument_is_ignored_without_fees(self):
        assert combine('LOW', 'HIGH', 'LOW', include_fees=False) == combine('LOW', None, 'LOW', include_fees=False)

    def test_worse_picks_the_more_severe(self):
        assert worse(None, 'LOW') == 'LOW' and worse('HIGH', 'MEDIUM') == 'HIGH' and worse(None, None) is None


@pytest.mark.django_db
class TestAttendanceCountsLeaveAsPresent:
    def test_leave_days_count_as_present(self, ctx):
        # 15 present, 5 leave, 5 absent: the old rule dropped the leave days, 15/20 = 75%;
        # now they count as present, 20/25 = 80%.
        mark_days(ctx, ['PRESENT'] * 15 + ['LEAVE'] * 5 + ['ABSENT'] * 5)
        entry = attendance_entry(ctx)
        assert entry['current_rate'] == 80.0
        assert (entry['present_days'], entry['total_days']) == (20, 25)
        assert entry['excused_leave_days'] == 5

    def test_all_leave_is_a_perfect_record(self, ctx):
        mark_days(ctx, ['PRESENT'] * 10 + ['LEAVE'] * 10)
        entry = attendance_entry(ctx)
        assert entry['current_rate'] == 100.0 and entry['severity'] is None

    def test_a_student_with_few_records_is_insufficient_not_flagged(self, ctx):
        mark_days(ctx, ['PRESENT', 'ABSENT', 'ABSENT'])
        entry = attendance_entry(ctx)
        assert entry['insufficient_data'] is True and entry['severity'] is None

    def test_a_student_with_no_records_still_comes_back_as_insufficient(self, ctx):
        entry = attendance_entry(ctx)
        assert entry['insufficient_data'] is True and entry['total_days'] == 0

    def test_the_default_report_still_lists_only_flagged_students(self, ctx):
        mark_days(ctx, ['PRESENT'] * 25)
        report = AttendanceRiskService(ctx['SID_A'], ctx['academic_year'].id).get_at_risk_students()
        assert ctx['student'].id not in {s['student_id'] for s in report['students']}

    def test_unflagged_entries_do_not_inflate_the_counts(self, ctx):
        mark_days(ctx, ['PRESENT'] * 25)
        report = AttendanceRiskService(ctx['SID_A'], ctx['academic_year'].id).get_at_risk_students(
            only_student_ids=[ctx['student'].id], include_unflagged=True)
        assert report['at_risk_count'] == 0 and sum(report['risk_levels'].values()) == 0


@pytest.mark.django_db
class TestFeeArrears:
    def test_three_months_owed_is_high(self, ctx):
        bill(ctx, 1, '1000', '0'); bill(ctx, 2, '2000', '1000'); bill(ctx, 3, '3000', '2000')
        info = fee_risk_for_students([ctx['student'].id])[ctx['student'].id]
        assert (info['pending'], info['months_owed'], info['level']) == (Decimal('3000'), Decimal('3'), 'HIGH')

    def test_one_month_owed_is_medium(self, ctx):
        bill(ctx, 1, '1000', '0')
        assert fee_risk_for_students([ctx['student'].id])[ctx['student'].id]['level'] == 'MEDIUM'

    def test_nothing_owed_is_not_flagged(self, ctx):
        account = Account.objects.create(school=ctx['school_a'], name='Cash', account_type='CASH')
        bill(ctx, 1, '1000', '0', paid='1000', payment_date=date(2026, 1, 5), account=account)
        info = fee_risk_for_students([ctx['student'].id])[ctx['student'].id]
        assert info['level'] is None and info['pending'] == 0 and info['months_overdue'] == 0

    def test_months_overdue_counts_the_months_nothing_was_paid(self, ctx):
        # Used to be always 0 because it filtered on a status that does not exist.
        bill(ctx, 1, '1000', '0'); bill(ctx, 2, '2000', '1000'); bill(ctx, 3, '3000', '2000')
        assert fee_risk_for_students([ctx['student'].id])[ctx['student'].id]['months_overdue'] == 3

    def test_a_student_with_no_fee_rows_has_zeros(self, ctx):
        info = fee_risk_for_students([ctx['student'].id])[ctx['student'].id]
        assert info['level'] is None and info['pending'] == 0 and info['months_owed'] == 0


@pytest.mark.django_db
class TestProfileAndRiskPageAgree:
    def _page_entry(self, ctx):
        report = StudentRiskScoreService(ctx['SID_A'], ctx['academic_year'].id).get_student_risk_scores()
        return next((s for s in report['students'] if s['student_id'] == ctx['student'].id), None)

    def _profile(self, ctx, **kw):
        return StudentRiskScoreService(ctx['SID_A'], ctx['academic_year'].id).score_student(ctx['student'].id, **kw)

    def test_a_student_flagged_on_attendance_and_fees_gets_the_same_score(self, ctx):
        mark_days(ctx, ['PRESENT'] * 10 + ['ABSENT'] * 15)
        bill(ctx, 1, '1000', '0'); bill(ctx, 2, '2000', '1000'); bill(ctx, 3, '3000', '2000')
        page, profile = self._page_entry(ctx), self._profile(ctx)
        assert page is not None
        assert (page['composite_score'], page['severity']) == (profile['composite_score'], profile['severity'])
        assert page['fee_risk_level'] == profile['fee']['level'] == 'HIGH'
        assert page['attendance_severity'] == profile['attendance']['severity']

    def test_arrears_alone_put_a_student_on_the_page(self, ctx):
        # Regular payment history but three months owed: only the arrears rule sees it.
        mark_days(ctx, ['PRESENT'] * 25)
        bill(ctx, 1, '1000', '0'); bill(ctx, 2, '2000', '1000'); bill(ctx, 3, '3000', '2000')
        page = self._page_entry(ctx)
        assert page and page['fee_risk_level'] == 'HIGH' and page['student_name']

    def test_an_untroubled_student_agrees_too(self, ctx):
        mark_days(ctx, ['PRESENT'] * 25)
        profile = self._profile(ctx)
        assert self._page_entry(ctx) is None  # not flagged anywhere, so not on the page
        assert (profile['composite_score'], profile['severity']) == (10.0, 'LOW')

    def test_no_data_at_all_is_not_flagged(self, ctx):
        profile = self._profile(ctx)
        assert profile['severity'] == 'LOW' and profile['composite_score'] == 10.0
        assert profile['attendance']['insufficient_data'] is True

    def test_hiding_fees_drops_the_fee_detail_and_renormalises(self, ctx):
        mark_days(ctx, ['PRESENT'] * 10 + ['ABSENT'] * 15)
        bill(ctx, 1, '1000', '0'); bill(ctx, 2, '2000', '1000'); bill(ctx, 3, '3000', '2000')
        with_fees, without = self._profile(ctx), self._profile(ctx, include_fees=False)
        assert without['fee'] is None
        assert without['composite_score'] == combine(
            with_fees['attendance']['severity'], None, with_fees['academic']['severity'], include_fees=False)[0]
        assert without['composite_score'] != with_fees['composite_score']
