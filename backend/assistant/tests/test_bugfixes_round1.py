"""Fixes found by running the whole baseline on school 37 (2026-11-08)."""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation
from assistant.tests.test_item4_tools import _all_agents_offered, _approve, _card, _ctx, _run, fam  # noqa: F401  (shared fixtures)

pytestmark = pytest.mark.django_db


def test_a_text_tool_result_no_longer_crashes_the_turn():
    from assistant.orchestrator import _choices_from
    assert _choices_from('find_student', {'data': 'plain text answer'}) == []
    assert _choices_from('get_attendance_summary_school', {'data': 'plain text answer'}) == []
    assert _choices_from('find_student', {'error': 'x'}) == []


def test_salary_with_decimal_numbers_in_allowances_no_longer_breaks_payslips():
    from hr.models import SalaryStructure
    s = SalaryStructure(basic_salary=Decimal('1000'), allowances={'rent': 10.5, 'fuel': 2}, deductions={'tax': 100.25})
    assert s.gross_salary == Decimal('1012.5') and s.total_deductions == Decimal('100.25') and s.net_salary == Decimal('912.25')
    assert SalaryStructure(basic_salary=Decimal('500'), allowances={}, deductions={}).net_salary == Decimal('500')


def test_a_school_prefix_does_not_hide_the_class():
    from assistant.skills.directory import class_key, class_matches
    assert class_key('SEED_TEST_Class_1A') == class_key('Class 1A') == class_key('1A') == '1a'
    assert class_matches(class_key('Class 1A'), class_key('SEED_TEST_Class_1A'))
    assert not class_matches(class_key('5'), class_key('Class 15'))


def test_find_student_says_when_nobody_has_the_whole_name(seed_data):
    from assistant.skills import directory
    ctx = _ctx(seed_data, seed_data['users']['admin'])
    out = directory.find_student(ctx, 'Ali Zzzname')
    assert 'NO student' in out['note']
    ok = directory.find_student(ctx, 'Ali Hassan')
    assert 'Ali Hassan' in ok['matches'][0]['name'] and 'NO student' not in ok['note']


def test_find_student_with_the_full_name_hides_partial_matches(seed_data):
    from assistant.skills import directory
    ctx = _ctx(seed_data, seed_data['users']['admin'])
    target = seed_data['students'][0]
    first, *rest = target.name.split()
    out = directory.find_student(ctx, target.name)
    assert out['matches'] and all(all(w.lower() in m['name'].lower() for w in target.name.split()) for m in out['matches'])
    if out['count'] == 1:
        assert 'Exactly one' in out['note']


def test_the_prompt_says_the_card_is_the_confirmation():
    from assistant.orchestrator import SYSTEM_PROMPT
    assert 'preview\n  card IS the confirmation' in SYSTEM_PROMPT and 'never ask "shall I' in SYSTEM_PROMPT


def test_a_teacher_asking_for_my_schedule_needs_no_name(seed_data):
    school = seed_data['school_a']
    school.enabled_modules = {**(school.enabled_modules or {}), 'academics': True}
    school.save(update_fields=['enabled_modules'])
    staff = seed_data['staff'][0]
    seen = {}

    def fake(self, name, params):
        seen.update(params)
        return {'ok': True}

    with patch('academics.ai_engine.AcademicsAIAgent._execute_tool', fake):
        out = _run(seed_data, 'get_teacher_schedule', user=staff.user)
    assert 'data' in out and staff.first_name in seen['teacher_name']


def test_message_to_the_parents_of_children_absent_today(seed_data, fam):
    from attendance.models import AttendanceRecord
    from notifications.models import NotificationLog
    AttendanceRecord.objects.create(school=fam['school'], student=fam['a'], date=timezone.localdate(), status='ABSENT')
    AttendanceRecord.objects.create(school=fam['school'], student=fam['b'], date=timezone.localdate(), status='PRESENT')
    card = _card(_run(seed_data, 'send_message_to_parents', title='Absent today', body='Your child was absent today.', absent_today=True))
    assert 'absent' in card.preview['rows'][0]['value'] and '(1)' in card.preview['rows'][0]['value']
    _approve(card, seed_data)
    log = NotificationLog.objects.get()
    assert log.recipient_user_id == fam['p1'].id and log.student_id == fam['a'].id


def test_absent_today_with_nobody_absent_is_refused(seed_data, fam):
    assert 'error' in _run(seed_data, 'send_message_to_parents', title='x', body='y', absent_today=True)


def test_absent_today_cannot_be_mixed_with_another_audience(seed_data, fam):
    assert 'error' in _run(seed_data, 'send_message_to_parents', title='x', body='y', absent_today=True, all_parents=True)


def test_a_parent_can_read_their_childs_homework_but_not_anothers(seed_data, fam):
    seen = {}

    class FakeHelper:
        def __init__(self, student, school):
            seen['student'] = student.id

        def _execute_tool(self, name, params):
            return {'assignments': [{'title': 'Diary'}]}

    with patch('students.study_helper_service.StudyHelperService', FakeHelper):
        out = _run(seed_data, 'get_child_homework', user=fam['p2'], child_id=fam['b'].id)
        assert out['data']['assignments'] and seen['student'] == fam['b'].id
        assert 'error' in _run(seed_data, 'get_child_homework', user=fam['p2'], child_id=fam['a'].id)


def test_class_and_section_are_two_things(seed_data):
    """"Class 9" is the class (every section); "9A", "9-B", "Class 9 section B", "ninth A" name one section."""
    from academic_sessions.models import SessionClass
    from assistant.skills import lms_common as lc
    from students.models import Class

    year = seed_data['academic_year']
    year.is_current = True
    year.save(update_fields=['is_current'])
    klass = Class.objects.create(school=seed_data['school_a'], name='Class 9', grade_level=9)
    for letter in 'AB':
        SessionClass.objects.create(school=seed_data['school_a'], academic_year=year, class_obj=klass, display_name='Class 9', section=letter, grade_level=9)
    ctx = _ctx(seed_data, seed_data['users']['admin'])

    def labels(text, section=None):
        return [lc.section_label(s) for s in lc.find_sections(ctx, text, section)]

    assert labels('Class 9') == labels('9') == labels('ninth') == ['Class 9 A', 'Class 9 B']
    assert labels('9A') == labels('9 a') == labels('Class 9A') == labels('Class 9 section A') == labels('ninth A') == ['Class 9 A']
    assert labels('9-B') == labels('Grade 9 B') == ['Class 9 B']
    assert labels('Class 9', 'B') == ['Class 9 B']
    assert labels('Class 9', 'C') == [] and labels('Class 19') == [] and labels('9C') == []


def test_a_whole_class_message_reaches_every_section(seed_data, fam):
    from notifications.models import NotificationLog
    name = fam['sec_a'].display_name                                     # sections A and B share this class
    card = _card(_run(seed_data, 'send_message_to_parents', title='Holiday', body='Closed Monday.', class_name=name))
    assert 'all sections' in card.preview['rows'][0]['value'] and '(2)' in card.preview['rows'][0]['value']          # both parents
    _approve(card, seed_data)
    assert {l.recipient_user_id for l in NotificationLog.objects.all()} == {fam['p1'].id, fam['p2'].id}


def test_a_single_section_message_still_reaches_only_that_section(seed_data, fam):
    card = _card(_run(seed_data, 'send_message_to_parents', title='Hi', body='Only A.', class_name=fam['sec_a'].display_name, section='A'))
    assert '(1)' in card.preview['rows'][0]['value'] and 'all sections' not in card.preview['rows'][0]['value']


def test_listing_a_class_lists_all_its_sections(seed_data, fam):
    out = _run(seed_data, 'list_students', class_name=fam['sec_a'].display_name)
    assert 'data' in out and out['data']['count'] == 4                    # 2 students in section A + 2 in B
    one = _run(seed_data, 'list_students', class_name=fam['sec_a'].display_name, section='B')['data']
    assert one['count'] == 2


def test_school_wide_attendance_is_not_answered_by_the_legacy_all_time_counter(seed_data):
    """Without a student or class the legacy tool counted every record ever ("951 absent today")."""
    out = _run(seed_data, 'get_attendance_summary')
    assert 'error' in out and 'get_attendance_summary_school' in out['error']


def test_lesson_plan_list_states_its_period(seed_data):
    from assistant.skills import lms_reads
    ctx = _ctx(seed_data, seed_data['users']['admin'])
    out = lms_reads.list_lesson_plans(ctx, date_from='2026-11-04', date_to='2026-11-10')
    assert out['period'] == '2026-11-04 to 2026-11-10'


def test_get_balance_is_described_as_the_net_position_to_date():
    assert 'ALL income' in registry.get_tool('get_balance').description


def _unpaid(fam, student, status='UNPAID'):
    from finance.models import FeePayment
    year = fam['sec_a'].academic_year
    return FeePayment.objects.create(school=fam['school'], student=student, fee_type='MONTHLY', month=10, year=2026,
                                     amount_due=Decimal('1000'), academic_year=year, status=status)


def test_message_to_parents_of_fee_pending_students(seed_data, fam):
    from notifications.models import NotificationLog
    _unpaid(fam, fam['a'])
    card = _card(_run(seed_data, 'send_message_to_parents', title='Fee reminder', body='Please clear the fee.', fee_pending=True))
    assert '(1)' in card.preview['rows'][0]['value'] and card.payload['event_type'] == 'FEE_DUE'
    _approve(card, seed_data)
    log = NotificationLog.objects.get()
    assert log.recipient_user_id == fam['p1'].id and log.student_id == fam['a'].id


def test_fee_pending_audience_can_be_limited_to_a_class_section(seed_data, fam):
    _unpaid(fam, fam['a'])
    _unpaid(fam, fam['b'])
    both = _card(_run(seed_data, 'send_message_to_parents', title='x', body='y', fee_pending=True))
    only_a = _card(_run(seed_data, 'send_message_to_parents', title='x', body='y', fee_pending=True,
                        class_name=fam['sec_a'].display_name, section='A'))
    assert '(2)' in both.preview['rows'][0]['value'] and '(1)' in only_a.preview['rows'][0]['value']


def test_fee_pending_with_nobody_owing_is_refused_and_cannot_be_mixed(seed_data, fam):
    assert 'error' in _run(seed_data, 'send_message_to_parents', title='x', body='y', fee_pending=True)
    _unpaid(fam, fam['a'])
    assert 'error' in _run(seed_data, 'send_message_to_parents', title='x', body='y', fee_pending=True, all_parents=True)


def test_list_scholarship_recipients(seed_data, fam):
    from finance.models import Scholarship, StudentDiscount
    fields = {f.name for f in Scholarship._meta.fields}
    sch = Scholarship.objects.create(school=fam['school'], name='Merit', **({'scholarship_type': 'PERCENTAGE'} if 'scholarship_type' in fields else {}),
                                     **({'value': Decimal('50')} if 'value' in fields else {}))
    StudentDiscount.objects.create(school=fam['school'], student=fam['a'], scholarship=sch, academic_year=fam['sec_a'].academic_year)
    out = _run(seed_data, 'list_scholarship_recipients')['data']
    assert out['count'] == 1 and out['recipients'][0]['student'] == fam['a'].name and out['recipients'][0]['scholarship'] == 'Merit'
