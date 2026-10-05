"""Every other surface that shows a transferred student's story: the parent and student
portals, the study helper, the staff AI agent, the promotion advisor and the PDF report.

All of them read through students.timeline, so a transferred student's earlier branch is
included (tagged, read-only, cut at the leaving date) and ordinary students are unchanged.
"""
import json
from datetime import date
from decimal import Decimal

import pytest

from academic_sessions.promotion_advisor_service import PromotionAdvisorService
from examinations.models import Exam
from finance.models import FeePayment, MonthlyFeeCategory
from notifications.ai_agent import ParentCommunicationAgent
from parents.models import ParentChild, ParentProfile
from reports.generators.student import StudentComprehensiveReportGenerator
from schools.models import UserSchoolMembership
from students.models import StudentProfile
from students.study_helper_service import StudyHelperService
from students.test_profile_history import add_exam, new_days, old_days, pair, subjects  # noqa: F401
from students.test_timeline import LEAVING, ctx  # noqa: F401
from students.test_transfer_risk import fee_row, school_days
from users.models import User

PARENT = '/api/parents/children'
PORTAL = '/api/students/portal'


def publish_all():
    Exam.objects.update(status=Exam.Status.PUBLISHED)


def make_user(pair_ctx, username, role, school):
    user = User.objects.create_user(
        username=username, email=f'{username}@test.com', password=pair_ctx['password'], role=role,
        school=school, organization=pair_ctx['org'],
    )
    UserSchoolMembership.objects.create(user=user, school=school, role=role, is_default=True)
    return user


@pytest.fixture
def parent(api, pair):
    user = make_user(pair, 'SEED_portal_parent', 'PARENT', pair['school_b'])
    profile = ParentProfile.objects.create(user=user, phone='+923007770000')
    ParentChild.objects.create(parent=profile, student=pair['new'], school=pair['school_b'], relation='FATHER')
    return {**pair, 'token': api.login('SEED_portal_parent')}


@pytest.fixture
def student_user(api, pair):
    user = make_user(pair, 'SEED_portal_student', 'STUDENT', pair['school_b'])
    StudentProfile.objects.create(user=user, student=pair['new'], school=pair['school_b'])
    return {**pair, 'token': api.login('SEED_portal_student')}


def with_history(pair_ctx):
    """Alpha: 10 present days + 1 exam + a paid fee. Beta: 4 days + a carried balance."""
    old_days(pair_ctx, *[(d, 'PRESENT') for d in school_days(date(2026, 2, 2), 10)])
    new_days(pair_ctx, *[(d, 'ABSENT') for d in school_days(date(2026, 3, 2), 2)])
    a, b = subjects(pair_ctx)
    add_exam(pair_ctx, pair_ctx['old'], pair_ctx['school_a'], pair_ctx['academic_year'], a, date(2026, 2, 10), 40)
    cat_a = MonthlyFeeCategory.objects.create(school=pair_ctx['school_a'], name='Tuition')
    cat_b = MonthlyFeeCategory.objects.create(school=pair_ctx['school_b'], name='Tuition')
    fee_row(pair_ctx, student=pair_ctx['old'], school=pair_ctx['school_a'], year_obj=pair_ctx['academic_year'],
            category=cat_a, month=1, due='1000', paid='1000', base='1000')
    fee_row(pair_ctx, student=pair_ctx['new'], school=pair_ctx['school_b'], year_obj=pair_ctx['place']['year'],
            category=cat_b, month=2, due='500', prev='500', base='0')
    return a, b


# ── Parent portal ────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestParentPortal:
    def get(self, api, parent, path):
        return api.get(f"{PARENT}/{parent['new'].id}/{path}/", parent['token'], parent['SID_B'])

    def test_overview_covers_both_branches(self, api, parent):
        with_history(parent)
        publish_all()
        body = self.get(api, parent, 'overview').json()
        att = body['attendance_summary']
        assert (att['total_days'], att['present'], att['absent']) == (12, 10, 2)
        assert Decimal(body['fee_summary']['total_paid']) == Decimal('1000')
        assert Decimal(body['fee_summary']['outstanding']) == Decimal('500')

    def test_the_latest_exam_is_shown_even_when_it_was_taken_at_the_earlier_branch(self, api, parent):
        with_history(parent)
        publish_all()
        assert self.get(api, parent, 'overview').json()['latest_exam']['marks_obtained'] == 40.0

    def test_unpublished_marks_are_never_shown_to_parents(self, api, parent):
        with_history(parent)                                 # exams stay in COMPLETED, not published
        assert self.get(api, parent, 'overview').json()['latest_exam'] is None
        assert self.get(api, parent, 'exam-results').json() == []

    def test_attendance_lists_both_branches_tagged_and_filters_by_month(self, api, parent):
        with_history(parent)
        rows = self.get(api, parent, 'attendance').json()
        assert len(rows) == 12
        assert {r['branch'] for r in rows} == {None, parent['school_a'].name}
        assert all(r['read_only'] for r in rows if r['branch'])
        march = api.get(f"{PARENT}/{parent['new'].id}/attendance/?month=3&year=2026", parent['token'], parent['SID_B']).json()
        assert len(march) == 2 and all(r['branch'] is None for r in march)

    def test_fees_list_both_ledgers(self, api, parent):
        with_history(parent)
        rows = self.get(api, parent, 'fees').json()
        assert len(rows) == 2 and {bool(r['branch']) for r in rows} == {True, False}

    def test_exam_results_are_published_only_dated_and_tagged(self, api, parent):
        a, b = with_history(parent)
        add_exam(parent, parent['new'], parent['school_b'], parent['place']['year'], b, date(2026, 3, 20), 90)
        publish_all()
        results = self.get(api, parent, 'exam-results').json()
        assert [r['exam_date'] for r in results] == ['2026-03-20', '2026-02-10']   # the old sort bug made this always []
        assert results[0]['branch'] is None and results[1]['branch'] == parent['school_a'].name

    def test_two_exams_with_the_same_name_stay_separate(self, api, parent):
        a, b = with_history(parent)
        for school, student, year, subject, when in (
            (parent['school_a'], parent['old'], parent['academic_year'], a, date(2026, 2, 11)),
            (parent['school_b'], parent['new'], parent['place']['year'], b, date(2026, 3, 21)),
        ):
            exam = add_exam(parent, student, school, year, subject, when, 70)
            exam.name = 'Quiz'
            exam.save(update_fields=['name'])
        publish_all()
        assert sum(1 for r in self.get(api, parent, 'exam-results').json() if r['exam_name'] == 'Quiz') == 2

    def test_another_parent_cannot_see_the_child(self, api, parent):
        stranger = make_user(parent, 'SEED_other_parent', 'PARENT', parent['school_b'])
        ParentProfile.objects.create(user=stranger, phone='+923008880000')
        token = api.login('SEED_other_parent')
        resp = api.get(f"{PARENT}/{parent['new'].id}/overview/", token, parent['SID_B'])
        assert resp.status_code == 403

    def test_an_admin_of_another_school_cannot_read_the_child(self, api, parent):
        resp = api.get(f"{PARENT}/{parent['new'].id}/overview/", parent['tokens']['admin'], parent['SID_A'])
        assert resp.status_code == 403

    def test_the_childs_own_school_admin_can(self, api, parent):
        resp = api.get(f"{PARENT}/{parent['new'].id}/overview/", parent['tokens']['admin_b'], parent['SID_B'])
        assert resp.status_code == 200


# ── Student portal ───────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestStudentPortal:
    def test_dashboard_covers_both_branches_with_the_shared_fee_figures(self, api, student_user):
        with_history(student_user)
        body = api.get(f'{PORTAL}/dashboard/', student_user['token'], student_user['SID_B']).json()
        assert (body['attendance']['total_days'], body['attendance']['present'], body['attendance']['absent']) == (12, 10, 2)
        assert Decimal(body['fees']['total_paid']) == Decimal('1000') and Decimal(body['fees']['outstanding']) == Decimal('500')

    def test_attendance_records_and_summary_cover_both_branches(self, api, student_user):
        with_history(student_user)
        body = api.get(f'{PORTAL}/attendance/', student_user['token'], student_user['SID_B']).json()
        assert body['summary']['total_days'] == 12 and body['summary']['present'] == 10
        assert {r['branch'] for r in body['records']} == {None, student_user['school_a'].name}

    def test_leave_counts_as_present_in_the_rate(self, api, student_user):
        old_days(student_user, (date(2026, 2, 2), 'LEAVE'), (date(2026, 2, 3), 'ABSENT'))
        body = api.get(f'{PORTAL}/attendance/', student_user['token'], student_user['SID_B']).json()
        assert body['summary']['rate'] == 50.0

    def test_fees_list_both_ledgers(self, api, student_user):
        with_history(student_user)
        assert len(api.get(f'{PORTAL}/fees/', student_user['token'], student_user['SID_B']).json()) == 2

    def test_results_are_published_only_and_include_the_earlier_branch(self, api, student_user):
        with_history(student_user)
        assert api.get(f'{PORTAL}/results/', student_user['token'], student_user['SID_B']).json() == []
        publish_all()
        results = api.get(f'{PORTAL}/results/', student_user['token'], student_user['SID_B']).json()
        assert len(results) == 1 and results[0]['branch'] == student_user['school_a'].name


# ── Study helper and the staff AI agent ──────────────────────────────────────

@pytest.mark.django_db
class TestStudyHelper:
    def helper(self, pair):
        return StudyHelperService(pair['new'], pair['school_b'])

    def test_marks_and_attendance_cover_both_branches(self, pair):
        with_history(pair)
        publish_all()
        helper = self.helper(pair)
        assert helper._get_my_marks()['total_results'] == 1
        assert helper._get_my_attendance(days=3650)['days_checked'] == 12

    def test_the_weak_subject_section_now_works_and_uses_the_earlier_branchs_results(self, pair):
        with_history(pair)                                   # 40% at the earlier branch
        publish_all()
        assert 'Subjects needing improvement' in self.helper(pair)._get_student_context()

    def test_unpublished_marks_are_not_shared_with_the_student(self, pair):
        with_history(pair)
        assert self.helper(pair)._get_my_marks()['total_results'] == 0


@pytest.mark.django_db
class TestStaffAgent:
    def agent(self, pair):
        return ParentCommunicationAgent(pair['SID_B'])

    def test_student_info_attendance_and_exams_cover_both_branches(self, pair):
        with_history(pair)
        agent = self.agent(pair)
        assert json.loads(agent._get_student_info(pair['new'].id))['attendance_rate'] == f"{round(10 / 12 * 100, 1)}%"
        summary = json.loads(agent._get_attendance_summary(student_id=pair['new'].id))
        assert (summary['total_records'], summary['present'], summary['absent']) == (12, 10, 2)
        assert json.loads(agent._get_exam_performance(pair['new'].id))['total'] == 1
        assert json.loads(agent._get_detailed_attendance(pair['new'].id, days=3650))['days_checked'] == 12

    def test_fee_status_uses_the_shared_calculation_across_branches(self, pair):
        with_history(pair)
        status = json.loads(self.agent(pair)._get_fee_status(pair['new'].id))
        assert (Decimal(status['total_paid']), Decimal(status['outstanding'])) == (Decimal('1000'), Decimal('500'))
        assert Decimal(status['total_due']) == Decimal('1500')

    def test_a_student_id_from_another_school_is_refused(self, pair):
        from students.models import Student
        with pytest.raises(Student.DoesNotExist):
            self.agent(pair)._get_student_info(pair['old'].id)        # the earlier record lives at Alpha


# ── Promotion advisor ────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestPromotionAdvisor:
    def recommendation(self, pair):
        rows = PromotionAdvisorService(pair['SID_B'], pair['place']['year'].id).get_recommendations(pair['place']['master'].id)
        return next(r for r in rows if r['student_id'] == pair['new'].id)

    def test_the_whole_year_counts_for_a_transferred_student(self, pair):
        old_days(pair, *[(d, 'PRESENT') for d in school_days(date(2026, 2, 2), 10)])
        new_days(pair, *[(d, 'ABSENT') for d in school_days(date(2026, 3, 2), 10)])
        a, _ = subjects(pair)
        add_exam(pair, pair['old'], pair['school_a'], pair['academic_year'], a, date(2026, 2, 10), 80)
        row = self.recommendation(pair)
        assert row['attendance_rate'] == 50.0                  # 10 of 20 days, not 0 of 10
        assert row['average_score'] == 80.0

    def test_the_carried_fee_row_is_not_counted_twice(self, pair):
        from student_exits.models import StudentExit
        exit_case = StudentExit.objects.get(destination_student=pair['new'])
        cat_a = MonthlyFeeCategory.objects.create(school=pair['school_a'], name='Tuition')
        cat_b = MonthlyFeeCategory.objects.create(school=pair['school_b'], name='Tuition')
        fee_row(pair, student=pair['old'], school=pair['school_a'], year_obj=pair['academic_year'], category=cat_a,
                month=2, due='1000', base='1000', handed=exit_case)
        fee_row(pair, student=pair['new'], school=pair['school_b'], year_obj=pair['place']['year'], category=cat_b,
                month=2, due='1000', prev='1000', base='0', carried=exit_case)
        # one unpaid month in total (the earlier branch's), not two
        assert self.recommendation(pair)['fee_paid_rate'] == 0.0
        from students.timeline import student_timeline
        earlier_segment = student_timeline(pair['new'])[0]
        earlier = PromotionAdvisorService(pair['SID_B'], pair['place']['year'].id)._earlier_fees(
            {pair['old'].id: (pair['new'].id, earlier_segment)})
        assert earlier[pair['new'].id]['total'] == 1


# ── PDF report ───────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestComprehensiveReport:
    def data(self, pair, student=None, school=None, year=None):
        generator = StudentComprehensiveReportGenerator(
            school or pair['school_b'],
            {'student_id': (student or pair['new']).id, 'academic_year': (year or pair['place']['year']).id},
        )
        return generator.get_data()

    def test_the_report_covers_both_branches_and_says_so(self, pair):
        with_history(pair)
        data = self.data(pair)
        assert data['working_days'] == 12 and data['present_count'] == 10 and data['absent_count'] == 2
        assert ('Includes Records From', pair['school_a'].name) in data['student_info_rows']
        assert any(row[0].endswith(f"({pair['school_a'].name})") for row in data['exam_rows'])
        assert data['fee_outstanding'] == Decimal('500')

    def test_the_carried_row_is_not_counted_twice_in_the_fee_chart(self, pair):
        with_history(pair)
        data = self.data(pair)
        assert data['fee_paid'] == Decimal('1000')

    def test_an_ordinary_student_gets_the_single_branch_report(self, pair):
        stranger = pair['students'][1]
        data = self.data(pair, student=stranger, school=pair['school_a'], year=pair['academic_year'])
        assert not any(row[0] == 'Includes Records From' for row in data['student_info_rows'])

    def test_remarks_fall_back_to_the_earlier_branchs_when_there_are_none_here(self, pair):
        from examinations.models import StudentTermAssessment
        StudentTermAssessment.objects.create(
            school=pair['school_a'], student=pair['old'], academic_year=pair['academic_year'], month=2,
            teacher_remark='Keen learner',
        )
        data = self.data(pair)
        assert data['assessment_exists'] is True and data['teacher_remark'] == 'Keen learner'
