"""Risk, badges and the AI assessment for a transferred student: what actually happened,
old plus new, read live through the timeline.

Setup (the exit leaves on 2026-03-01): the old record at School Alpha has the earlier
attendance, exams and fees; the new record at School Beta has what happened since.
The Beta academic year used here runs 2025-04-01 to 2026-03-31.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from academic_sessions.attendance_risk_service import AttendanceRiskService
from academic_sessions.models import SchoolCalendarEntry
from academic_sessions.student_risk_score_service import StudentRiskScoreService
from examinations.academic_risk_service import AcademicRiskService
from finance.fee_predictor_service import FeeCollectionPredictorService
from finance.fee_risk import fee_risk_for_students, student_fee_risk
from finance.models import FeePayment, MonthlyFeeCategory
from parents.models import ParentLeaveRequest, ParentProfile
from students import timeline
from students.ai_service import Student360Service
from students.test_profile_history import add_exam, new_days, old_days, pair, subjects  # noqa: F401
from students.test_timeline import LEAVING, ctx  # noqa: F401
from users.models import User


def school_days(start, count):
    """``count`` consecutive school days (Sundays skipped) from ``start``."""
    days, day = [], start
    while len(days) < count:
        if day.weekday() != 6:
            days.append(day)
        day += timedelta(days=1)
    return days


def timelines_of(pair_ctx):
    return {pair_ctx['new'].id: timeline.student_timeline(pair_ctx['new'])}


def attendance_entry(pair_ctx, *, with_history=True, school_id=None, year=None):
    service = AttendanceRiskService(school_id or pair_ctx['SID_B'], (year or pair_ctx['place']['year']).id)
    report = service.get_at_risk_students(
        only_student_ids=[pair_ctx['new'].id], include_unflagged=True,
        timelines=timelines_of(pair_ctx) if with_history else None,
    )
    return next(s for s in report['students'] if s['student_id'] == pair_ctx['new'].id)


def fee_row(pair_ctx, *, student, school, year_obj, category, month, due, paid='0', base=None, prev='0', carried=None, handed=None):
    paid = Decimal(paid)
    extra = {}
    if paid:
        from finance.models import Account
        extra = {'payment_date': date(2026, month, 5),
                 'account': Account.objects.get_or_create(school=school, name='Cash', defaults={'account_type': 'CASH'})[0]}
    return FeePayment.objects.create(
        school=school, academic_year=year_obj, student=student, fee_type='MONTHLY', monthly_category=category,
        month=month, year=2026, amount_due=Decimal(due), amount_paid=paid, previous_balance=Decimal(prev),
        base_monthly_fee=Decimal(base) if base is not None else None,
        status='PAID' if Decimal(due) == paid else ('PARTIAL' if paid else 'UNPAID'),
        carried_from_exit=carried, handed_over_to_exit=handed, **extra,
    )


# ── Attendance ───────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestAttendanceRisk:
    def test_the_earlier_branchs_days_make_a_student_scoreable_who_had_too_few_here(self, pair):
        old_days(pair, *[(d, 'PRESENT' if i % 2 == 0 else 'ABSENT') for i, d in enumerate(school_days(date(2026, 2, 2), 12))])
        new_days(pair, *[(d, 'PRESENT') for d in school_days(date(2026, 3, 2), 3)])
        alone, together = attendance_entry(pair, with_history=False), attendance_entry(pair)
        assert alone['insufficient_data'] is True                       # 3 days here: not enough to judge
        assert together['insufficient_data'] is False
        assert (together['total_days'], together['present_days']) == (15, 9)
        assert together['current_rate'] == 60.0 and together['severity'] in ('HIGH', 'MEDIUM')

    def test_absences_on_both_sides_of_the_transfer_are_counted_together(self, pair):
        old_days(pair, *[(d, 'PRESENT') for d in school_days(date(2026, 1, 12), 10)])
        old_days(pair, (date(2026, 2, 26), 'ABSENT'), (date(2026, 2, 27), 'ABSENT'))
        new_days(pair, (date(2026, 3, 2), 'ABSENT'), (date(2026, 3, 3), 'ABSENT'))
        entry = attendance_entry(pair)
        assert entry['total_days'] == 14 and entry['present_days'] == 10      # 4 absences of 14, two at each branch

    def test_sundays_and_the_earlier_branchs_holidays_are_not_absences(self, pair):
        base = school_days(date(2026, 2, 2), 10)
        old_days(pair, *[(d, 'PRESENT') for d in base])
        old_days(pair, (date(2026, 2, 8), 'ABSENT'))                       # a Sunday
        SchoolCalendarEntry.objects.create(                                  # Alpha's own holiday
            school=pair['school_a'], academic_year=pair['academic_year'], name='Founders Day', entry_kind='OFF_DAY',
            off_day_type='NATIONAL_HOLIDAY', scope='SCHOOL', start_date=date(2026, 2, 20), end_date=date(2026, 2, 20),
            affects_students=True, is_active=True,
        )
        old_days(pair, (date(2026, 2, 20), 'ABSENT'))
        entry = attendance_entry(pair)
        assert entry['total_days'] == 10 and entry['present_days'] == 10   # neither stray absence counts

    def test_approved_leave_at_the_earlier_branch_counts_as_present(self, pair):
        base = school_days(date(2026, 2, 2), 10)
        old_days(pair, *[(d, 'PRESENT') for d in base])
        old_days(pair, (date(2026, 2, 16), 'ABSENT'))
        parent = ParentProfile.objects.create(
            user=User.objects.create_user(username='SEED_risk_parent', email='rp@test.com', password='x', role='PARENT',
                                          school=pair['school_a'], organization=pair['org']),
            phone='+923001110000',
        )
        ParentLeaveRequest.objects.create(
            school=pair['school_a'], parent=parent, student=pair['old'], start_date=date(2026, 2, 16),
            end_date=date(2026, 2, 16), reason='Medical', status='APPROVED',
        )
        entry = attendance_entry(pair)
        assert entry['total_days'] == 11 and entry['present_days'] == 11 and entry['excused_leave_days'] == 1

    def test_days_after_the_leaving_date_and_before_the_academic_year_do_not_count(self, pair):
        old_days(pair, *[(d, 'PRESENT') for d in school_days(date(2026, 2, 2), 10)])
        old_days(pair, (date(2026, 3, 9), 'ABSENT'))                        # recorded at Alpha after leaving
        old_days(pair, (date(2025, 1, 6), 'ABSENT'))                        # before Beta's year starts (2025-04-01)
        entry = attendance_entry(pair)
        assert entry['total_days'] == 10 and entry['present_days'] == 10

    def test_an_ordinary_student_is_scored_exactly_as_before(self, pair):
        stranger = pair['students'][1]
        from students.test_profile_history import day
        for i, d in enumerate(school_days(date(2026, 2, 2), 12)):
            day(None, stranger, pair['school_a'], pair['academic_year'], d, 'PRESENT' if i < 9 else 'ABSENT')
        from academic_sessions.models import StudentEnrollment
        StudentEnrollment.objects.create(
            school=pair['school_a'], student=stranger, academic_year=pair['academic_year'],
            class_obj=stranger.class_obj, roll_number=stranger.roll_number, status='ACTIVE',
        )
        service = AttendanceRiskService(pair['SID_A'], pair['academic_year'].id)
        plain = service.get_at_risk_students(only_student_ids=[stranger.id], include_unflagged=True)
        with_none = service.get_at_risk_students(only_student_ids=[stranger.id], include_unflagged=True, timelines={})
        assert plain == with_none and plain['students'][0]['total_days'] == 12


# ── Academics ────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestAcademicRisk:
    def _entry(self, pair, with_history=True):
        report = AcademicRiskService(pair['SID_B'], pair['place']['year'].id).get_at_risk_students(
            only_student_ids=[pair['new'].id], include_unflagged=True,
            timelines=timelines_of(pair) if with_history else None,
        )
        return next(s for s in report['students'] if s['student_id'] == pair['new'].id)

    def test_an_exam_taken_at_the_earlier_branch_counts_so_the_student_is_not_unscored(self, pair):
        a, _ = subjects(pair)
        add_exam(pair, pair['old'], pair['school_a'], pair['academic_year'], a, date(2026, 2, 10), 30)
        assert self._entry(pair, with_history=False)['insufficient_data'] is True
        entry = self._entry(pair)
        assert entry['insufficient_data'] is False and entry['current_average'] == 30.0
        assert entry['severity'] in ('HIGH', 'MEDIUM')

    def test_the_trend_runs_across_both_branches(self, pair):
        a, b = subjects(pair)
        add_exam(pair, pair['old'], pair['school_a'], pair['academic_year'], a, date(2026, 2, 10), 80)
        add_exam(pair, pair['new'], pair['school_b'], pair['place']['year'], b, date(2026, 3, 20), 40)
        entry = self._entry(pair)
        assert entry['exams_recorded'] == 2 and entry['trend'] == 'declining'
        assert entry['current_average'] == 40.0                      # the most recent exam, wherever it was taken

    def test_an_exam_from_before_this_academic_year_is_not_used(self, pair):
        a, _ = subjects(pair)
        add_exam(pair, pair['old'], pair['school_a'], pair['academic_year'], a, date(2025, 1, 10), 20)
        assert self._entry(pair)['insufficient_data'] is True


# ── Fees ─────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestFeeRisk:
    @pytest.fixture
    def fees(self, pair):
        from student_exits.models import StudentExit
        exit_case = StudentExit.objects.get(destination_student=pair['new'])
        cat_a = MonthlyFeeCategory.objects.create(school=pair['school_a'], name='Tuition')
        cat_b = MonthlyFeeCategory.objects.create(school=pair['school_b'], name='Tuition')
        year_a, year_b = pair['academic_year'], pair['place']['year']
        # Alpha: Jan unpaid, Feb unpaid and cumulative (owes 2 x 1000 = 2000); handed over to Beta
        fee_row(pair, student=pair['old'], school=pair['school_a'], year_obj=year_a, category=cat_a, month=1, due='1000', base='1000')
        feb = fee_row(pair, student=pair['old'], school=pair['school_a'], year_obj=year_a, category=cat_a, month=2,
                      due='2000', base='1000', prev='1000', handed=exit_case)
        # Beta: the carried opening balance (no monthly fee of its own)
        carried = fee_row(pair, student=pair['new'], school=pair['school_b'], year_obj=year_b, category=cat_b, month=2,
                          due='2000', base='0', prev='2000', carried=exit_case)
        return {**pair, 'feb': feb, 'carried': carried}

    def test_months_owed_uses_the_earlier_branchs_monthly_fee_for_a_carried_balance(self, fees):
        plain = fee_risk_for_students([fees['new'].id])[fees['new'].id]
        with_history = fee_risk_for_students([fees['new'].id], timelines_of(fees))[fees['new'].id]
        assert plain['months_owed'] == 0                                       # carried row has no monthly fee
        assert with_history['months_owed'] == Decimal('2')                   # 2000 owed / 1000 a month
        assert with_history['level'] == 'MEDIUM'

    def test_months_overdue_counts_the_earlier_unpaid_months_without_double_counting_the_carried_row(self, fees):
        info = fee_risk_for_students([fees['new'].id], timelines_of(fees))[fees['new'].id]
        assert info['months_overdue'] == 2                                   # Jan and Feb at Alpha, not 3

    def test_what_is_owed_is_still_only_the_current_branchs(self, fees):
        info = fee_risk_for_students([fees['new'].id], timelines_of(fees))[fees['new'].id]
        assert info['pending'] == Decimal('2000')
        assert fee_risk_for_students([fees['old'].id])[fees['old'].id]['pending'] == 0   # handed over

    def test_student_fee_risk_accepts_the_timeline(self, fees):
        segments = timeline.student_timeline(fees['new'])
        assert student_fee_risk(fees['new'].id, segments)['months_owed'] == Decimal('2')

    def test_the_predictor_judges_the_whole_payment_history(self, fees):
        service = FeeCollectionPredictorService(fees['SID_B'], fees['place']['year'].id)

        def probability(**kw):
            report = service.predict_defaults(only_student_ids=[fees['new'].id], include_unflagged=True, **kw)
            return next(p for p in report['predictions'] if p['student_id'] == fees['new'].id)

        alone, together = probability(), probability(timelines=timelines_of(fees))
        assert together['default_probability'] >= alone['default_probability']
        assert together['default_probability'] > 0

    def test_an_ordinary_students_fee_risk_is_unchanged(self, fees):
        stranger = fees['students'][1]
        assert fee_risk_for_students([stranger.id]) == fee_risk_for_students([stranger.id], {})


# ── One definition of risk ───────────────────────────────────────────────────

@pytest.mark.django_db
class TestOneDefinition:
    @pytest.fixture
    def flagged(self, pair):
        old_days(pair, *[(d, 'PRESENT' if i % 2 == 0 else 'ABSENT') for i, d in enumerate(school_days(date(2026, 2, 2), 12))])
        new_days(pair, *[(d, 'PRESENT') for d in school_days(date(2026, 3, 2), 3)])
        a, b = subjects(pair)
        add_exam(pair, pair['old'], pair['school_a'], pair['academic_year'], a, date(2026, 2, 10), 30)
        return pair

    def test_the_profile_and_the_risk_page_agree_for_a_transferred_student(self, flagged):
        service = StudentRiskScoreService(flagged['SID_B'], flagged['place']['year'].id)
        page = next(s for s in service.get_student_risk_scores()['students'] if s['student_id'] == flagged['new'].id)
        profile = service.score_student(flagged['new'].id)
        assert (page['composite_score'], page['severity']) == (profile['composite_score'], profile['severity'])
        assert page['attendance_severity'] == profile['attendance']['severity'] is not None
        assert page['academic_severity'] == profile['academic']['severity'] is not None

    def test_the_old_branchs_data_is_what_flagged_them(self, flagged):
        service = StudentRiskScoreService(flagged['SID_B'], flagged['place']['year'].id)
        page_ids = {s['student_id'] for s in service.get_student_risk_scores()['students']}
        assert flagged['new'].id in page_ids
        # Without the earlier branch there would be nothing to judge: the new branch has 3 days and no exam.
        assert attendance_entry(flagged, with_history=False)['insufficient_data'] is True

    def test_the_old_record_is_not_judged_on_the_new_branchs_data(self, flagged):
        report = AttendanceRiskService(flagged['SID_A'], flagged['academic_year'].id).get_at_risk_students(
            only_student_ids=[flagged['old'].id], include_unflagged=True)
        entry = next((s for s in report['students'] if s['student_id'] == flagged['old'].id), None)
        assert entry is None or entry['total_days'] == 12


# ── The AI assessment on the profile ─────────────────────────────────────────

@pytest.mark.django_db
class TestStudent360:
    @pytest.fixture(autouse=True)
    def no_llm(self, settings):
        settings.GROQ_API_KEY = ''

    def profile(self, pair, **kw):
        return Student360Service(pair['SID_B'], pair['new'].id).generate_profile(**kw)

    def test_the_numbers_cover_both_branches(self, pair):
        old_days(pair, *[(d, 'PRESENT') for d in school_days(date(2026, 2, 2), 10)])
        new_days(pair, *[(d, 'PRESENT') for d in school_days(date(2026, 3, 2), 4)])
        a, _ = subjects(pair)
        add_exam(pair, pair['old'], pair['school_a'], pair['academic_year'], a, date(2026, 2, 10), 75)
        body = self.profile(pair)
        assert body['attendance']['total_days'] == 14 and body['attendance']['insufficient_data'] is False
        assert body['academic']['avg_score'] == 75.0 and body['academic']['insufficient_data'] is False
        assert body['earlier_branches'] == [pair['school_a'].name]

    def test_a_carried_balance_reads_as_months_owed_not_zero(self, pair):
        from student_exits.models import StudentExit
        exit_case = StudentExit.objects.get(destination_student=pair['new'])
        cat_a = MonthlyFeeCategory.objects.create(school=pair['school_a'], name='Tuition')
        cat_b = MonthlyFeeCategory.objects.create(school=pair['school_b'], name='Tuition')
        fee_row(pair, student=pair['old'], school=pair['school_a'], year_obj=pair['academic_year'], category=cat_a,
                month=2, due='1500', base='1500', handed=exit_case)
        fee_row(pair, student=pair['new'], school=pair['school_b'], year_obj=pair['place']['year'], category=cat_b,
                month=2, due='1500', base='0', prev='1500', carried=exit_case)
        fin = self.profile(pair)['financial']
        assert fin['months_owed'] == 1.0 and fin['outstanding'] == 1500.0
        assert fin['months_overdue'] == 1 and fin['insufficient_data'] is False

    def test_fees_paid_at_the_earlier_branch_count_in_paid_rate(self, pair):
        cat_a = MonthlyFeeCategory.objects.create(school=pair['school_a'], name='Tuition')
        fee_row(pair, student=pair['old'], school=pair['school_a'], year_obj=pair['academic_year'], category=cat_a,
                month=1, due='1000', paid='1000', base='1000')
        assert self.profile(pair)['financial']['paid_rate'] == 100.0

    def test_the_weakest_subject_merges_the_same_subject_across_branches(self, pair):
        a, b = subjects(pair)                       # different Subject rows per branch
        a.name = b.name = 'Mathematics'
        a.save(update_fields=['name'])
        add_exam(pair, pair['old'], pair['school_a'], pair['academic_year'], a, date(2026, 2, 10), 20)
        add_exam(pair, pair['new'], pair['school_b'], pair['place']['year'], b, date(2026, 3, 20), 40)
        assert self.profile(pair)['academic']['weakest'] == 'Mathematics'

    def test_a_non_finance_role_still_sees_no_fee_detail(self, pair):
        body = self.profile(pair, include_fees=False)
        assert 'financial' not in body and body['fees_hidden'] is True

    def test_an_ordinary_student_has_no_earlier_branches(self, pair):
        stranger = pair['students'][1]
        body = Student360Service(pair['SID_A'], stranger.id).generate_profile()
        assert body['earlier_branches'] == []


@pytest.mark.django_db
def test_the_summary_says_it_includes_the_earlier_branch(pair, settings):
    settings.GROQ_API_KEY = ''
    body = Student360Service(pair['SID_B'], pair['new'].id).generate_profile()
    assert f"Includes records from {pair['school_a'].name}" in body['ai_summary']
    plain = Student360Service(pair['SID_A'], pair['students'][1].id).generate_profile()
    assert 'Includes records from' not in plain['ai_summary']
