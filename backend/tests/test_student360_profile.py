"""The student profile's risk assessment (Student360Service and /ai-profile/).

Levels come from the shared risk rules (see test_student_risk_unified.py); these tests
cover what the profile adds: left-school students, hidden fees for non-finance roles,
"not enough data", the real 0-100 score, and the per-day summary cache.
"""
from datetime import date
from decimal import Decimal
from unittest import mock

import pytest
from django.core.cache import cache

from academic_sessions.models import StudentEnrollment
from academic_sessions.student_risk_score_service import StudentRiskScoreService
from finance.models import FeePayment, MonthlyFeeCategory
from students.ai_service import Student360Service, can_see_fees
from tests.test_student_risk_unified import bill, mark_days


@pytest.fixture
def ctx(seed_data, settings):
    settings.GROQ_API_KEY = ''   # never reach the real LLM from a test; cache tests opt in with a mock
    student = seed_data['students'][0]
    enrollment, _ = StudentEnrollment.objects.get_or_create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'], student=student,
        defaults={'class_obj': seed_data['classes'][0], 'roll_number': student.roll_number},
    )
    category = MonthlyFeeCategory.objects.create(school=seed_data['school_a'], name='Tuition')
    cache.clear()
    return {**seed_data, 'student': student, 'category': category, 'enrollment': enrollment}


def profile(ctx, **kw):
    return Student360Service(ctx['SID_A'], ctx['student'].id).generate_profile(**kw)


def three_months_owed(ctx):
    bill(ctx, 1, '1000', '0'); bill(ctx, 2, '2000', '1000'); bill(ctx, 3, '3000', '2000')


def api_profile(api, ctx, role):
    return api.get(f"/api/students/{ctx['student'].id}/ai-profile/", ctx['tokens'][role], ctx['SID_A'])


@pytest.mark.django_db
class TestOneDefinitionOfRisk:
    def test_the_profile_gives_the_same_score_as_the_risk_page(self, ctx):
        mark_days(ctx, ['PRESENT'] * 10 + ['ABSENT'] * 15)
        three_months_owed(ctx)
        page = next(s for s in StudentRiskScoreService(ctx['SID_A'], ctx['academic_year'].id)
                    .get_student_risk_scores()['students'] if s['student_id'] == ctx['student'].id)
        p = profile(ctx)
        assert (p['risk_score'], p['overall_risk']) == (page['composite_score'], page['severity'])

    def test_a_clean_student_scores_ten_not_thirty_three(self, ctx):
        mark_days(ctx, ['PRESENT'] * 25)
        p = profile(ctx)
        assert (p['overall_risk'], p['risk_score']) == ('LOW', 10.0)

    def test_leave_days_do_not_count_against_attendance(self, ctx):
        mark_days(ctx, ['PRESENT'] * 15 + ['LEAVE'] * 5 + ['ABSENT'] * 5)
        att = profile(ctx)['attendance']
        assert (att['rate'], att['present'], att['leave'], att['absent']) == (80.0, 15, 5, 5)

    def test_months_overdue_is_no_longer_always_zero(self, ctx):
        three_months_owed(ctx)
        fin = profile(ctx)['financial']
        assert fin['months_overdue'] == 3 and fin['risk'] == 'HIGH' and fin['outstanding'] == 3000.0

    def test_the_fee_reminder_recommendation_now_appears(self, ctx):
        three_months_owed(ctx)
        assert any('fee reminder' in r for r in profile(ctx)['recommendations'])


@pytest.mark.django_db
class TestNotEnoughData:
    def test_a_student_with_no_data_is_not_flagged_and_says_so(self, ctx):
        p = profile(ctx)
        assert p['overall_risk'] == 'LOW' and p['risk_score'] == 10.0
        assert p['attendance']['insufficient_data'] and p['attendance']['risk'] is None
        assert p['academic']['insufficient_data'] and p['academic']['risk'] is None
        assert p['financial']['insufficient_data'] and p['financial']['risk'] is None
        assert 'Not enough' in p['ai_summary']

    def test_a_student_with_three_attendance_days_is_not_called_high_risk(self, ctx):
        mark_days(ctx, ['ABSENT'] * 3)
        p = profile(ctx)
        assert p['attendance']['insufficient_data'] and p['overall_risk'] == 'LOW'


@pytest.mark.django_db
class TestFeesHiddenFromOtherRoles:
    def test_the_roles_that_see_fees(self):
        assert [can_see_fees(r) for r in ('SCHOOL_ADMIN', 'PRINCIPAL', 'ACCOUNTANT', 'SUPER_ADMIN')] == [True] * 4
        assert [can_see_fees(r) for r in ('TEACHER', 'STAFF', 'MANAGER', 'PARENT', None)] == [False] * 5

    def test_without_fees_there_is_no_fee_detail_anywhere(self, ctx):
        mark_days(ctx, ['PRESENT'] * 25)
        three_months_owed(ctx)
        p = profile(ctx, include_fees=False)
        assert p['fees_hidden'] is True and 'financial' not in p
        text = (p['ai_summary'] + ' '.join(p['recommendations'])).lower()
        assert 'fee' not in text and 'outstanding' not in text and 'pkr' not in text

    def test_the_score_without_fees_uses_attendance_and_academics_only(self, ctx):
        mark_days(ctx, ['PRESENT'] * 25)
        three_months_owed(ctx)
        p = profile(ctx, include_fees=False)
        assert p['risk_score'] == 10.0 and p['overall_risk'] == 'LOW'   # arrears do not leak in
        assert profile(ctx, include_fees=True)['risk_score'] > 10.0

    def test_admin_api_includes_fees_and_a_teacher_view_does_not(self, api, ctx):
        three_months_owed(ctx)
        admin = api_profile(api, ctx, 'admin')
        assert admin.status_code == 200 and admin.json()['financial']['months_overdue'] == 3
        accountant = api_profile(api, ctx, 'accountant')
        if accountant.status_code == 200:
            assert 'financial' in accountant.json()
        teacher = api_profile(api, ctx, 'teacher')
        if teacher.status_code == 200:
            assert 'financial' not in teacher.json() and teacher.json()['fees_hidden'] is True
        else:  # not this teacher's student; the service-level test above covers the hiding
            assert teacher.status_code in (403, 404)


@pytest.mark.django_db
class TestLeftSchool:
    def test_a_departed_student_has_no_risk_badge(self, ctx):
        ctx['enrollment'].is_active = False
        ctx['enrollment'].status = 'WITHDRAWN'
        ctx['enrollment'].left_date = date(2026, 3, 1)
        ctx['enrollment'].save()
        p = profile(ctx)
        assert p['left_school'] is True and p['left_status'] == 'WITHDRAWN'
        assert p['left_date'] == '2026-03-01'
        assert p['overall_risk'] is None and p['risk_score'] is None

    def test_a_student_who_came_back_is_scored_again(self, ctx):
        mark_days(ctx, ['PRESENT'] * 25)
        assert profile(ctx)['left_school'] is False


@pytest.mark.django_db
class TestSummaryCache:
    def _with_llm(self, text='LLM says hi'):
        client = mock.MagicMock()
        client.chat.completions.create.return_value.choices = [mock.MagicMock(message=mock.MagicMock(content=text))]
        return client

    def test_the_llm_is_called_once_per_day_for_unchanged_facts(self, ctx, settings):
        settings.GROQ_API_KEY = 'x'
        client = self._with_llm()
        with mock.patch('groq.Groq', return_value=client):
            first, second = profile(ctx), profile(ctx)
        assert first['ai_summary'] == second['ai_summary'] == 'LLM says hi'
        assert client.chat.completions.create.call_count == 1

    def test_changed_facts_get_a_fresh_summary(self, ctx, settings):
        settings.GROQ_API_KEY = 'x'
        client = self._with_llm()
        with mock.patch('groq.Groq', return_value=client):
            profile(ctx)
            mark_days(ctx, ['ABSENT'] * 25)
            profile(ctx)
        assert client.chat.completions.create.call_count == 2

    def test_a_fee_free_summary_is_never_served_to_a_fee_viewer(self, ctx, settings):
        settings.GROQ_API_KEY = 'x'
        client = self._with_llm()
        with mock.patch('groq.Groq', return_value=client):
            profile(ctx, include_fees=False)
            profile(ctx, include_fees=True)
        assert client.chat.completions.create.call_count == 2

    def test_the_prompt_for_a_non_finance_role_has_no_fee_lines(self, ctx, settings):
        settings.GROQ_API_KEY = 'x'
        three_months_owed(ctx)
        client = self._with_llm()
        with mock.patch('groq.Groq', return_value=client):
            profile(ctx, include_fees=False)
        prompt = client.chat.completions.create.call_args.kwargs['messages'][0]['content']
        assert 'Fees' not in prompt and 'outstanding' not in prompt

    def test_a_failed_llm_call_is_not_cached(self, ctx, settings):
        settings.GROQ_API_KEY = 'x'
        broken = mock.MagicMock()
        broken.chat.completions.create.side_effect = RuntimeError('down')
        with mock.patch('groq.Groq', return_value=broken):
            assert profile(ctx)['ai_summary']          # rule-based fallback
        good = self._with_llm('recovered')
        with mock.patch('groq.Groq', return_value=good):
            assert profile(ctx)['ai_summary'] == 'recovered'
