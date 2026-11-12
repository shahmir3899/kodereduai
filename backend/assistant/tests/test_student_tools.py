"""Students & admissions through the assistant: profile / counts / enquiries, enquiry writes, student edit, class change, fee edits.
The model is mocked; reads and writes go through the real students / admissions / finance API as the signed-in user."""
from datetime import date

import pytest
from django.utils import timezone

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _all_agents_offered():
    from unittest.mock import patch
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


@pytest.fixture
def stu(seed_data, seed_sections):
    school, year, master = seed_data['school_a'], seed_data['academic_year'], seed_data['classes'][0]
    school.enabled_modules = {**(school.enabled_modules or {}), 'students': True, 'admissions': True, 'finance': True}
    school.save(update_fields=['enabled_modules'])
    org = school.organization
    org.allowed_modules = {**(org.allowed_modules or {}), 'students': True, 'admissions': True, 'finance': True}
    org.save(update_fields=['allowed_modules'])
    year.is_current = True
    year.start_date, year.end_date = date(2020, 1, 1), date(2099, 12, 31)      # a wide year so "today" is always inside it
    year.save()
    return {'a': seed_sections['a_students'][0], 'a2': seed_sections['a_students'][1], 'b': seed_sections['b_students'][0],
            'sec_a': seed_sections['section_a'], 'sec_b': seed_sections['section_b'], 'year': year, 'school': school}


def _run(seed, tool, uname='admin', **args):
    user = seed['users'][uname]
    ctx = registry.ToolContext(user=user, school_id=seed['SID_A'], role=user.role)
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=ctx.user)
    return registry.execute(ctx, tool, args)


def _card(out):
    assert 'proposal' in out, out
    return AgentAction.objects.get(pk=out['proposal']['action_id'])


def _approve(card, seed, uname='admin'):
    return engine.approve(card.id, seed['users'][uname], seed['SID_A'])


def _enquiry(stu, status='NEW', name='Zain Ali', mobile='0300-1112223'):
    from admissions.models import AdmissionEnquiry
    return AdmissionEnquiry.objects.create(school=stu['school'], name=name, father_name='Bilal Ali', mobile=mobile, status=status)


class TestReads:
    def test_profile_for_admin_includes_fees(self, seed_data, stu):
        out = _run(seed_data, 'get_student_profile', student_id=stu['a'].id)['data']
        assert out['student_id'] == stu['a'].id and 'fees' in out and out['class_this_year']

    def test_profile_for_teacher_outside_scope_is_refused(self, seed_data, stu):
        assert 'error' in _run(seed_data, 'get_student_profile', 'teacher', student_id=stu['a'].id)

    def test_profile_by_name(self, seed_data, stu):
        assert _run(seed_data, 'get_student_profile', student_name='Usman')['data']['student_id'] == stu['b'].id

    def test_count_students(self, seed_data, stu):
        out = _run(seed_data, 'count_students')['data']
        assert out['total_active'] >= 4 and sum(out['by_class_this_year'].values()) == 4

    def test_enquiry_counts_and_list(self, seed_data, stu):
        _enquiry(stu, 'NEW'); _enquiry(stu, 'CONFIRMED', 'Hira', '0300-9')
        c = _run(seed_data, 'count_enquiries')['data']
        assert c['new'] == 1 and c['confirmed'] == 1 and c['open'] == 2
        assert _run(seed_data, 'list_enquiries', status='CONFIRMED')['data']['count'] == 1

    def test_get_enquiry_with_history(self, seed_data, stu):
        e = _enquiry(stu)
        assert _run(seed_data, 'get_enquiry', enquiry_id=e.id)['data']['child'] == 'Zain Ali'

    def test_teacher_has_no_enquiry_or_fee_tools(self, seed_data, stu):
        for tool in ('count_enquiries', 'get_student_fees', 'count_students'):
            assert 'error' in _run(seed_data, tool, 'teacher')


class TestEnquiryWrites:
    def test_add_enquiry_creates_nothing_until_approved(self, seed_data, stu):
        from admissions.models import AdmissionEnquiry
        card = _card(_run(seed_data, 'add_enquiry', child_name='Zain', father_name='Bilal', mobile='0300-5551234', source='phone'))
        assert not AdmissionEnquiry.objects.exists()
        _approve(card, seed_data)
        e = AdmissionEnquiry.objects.get()
        assert e.source == 'PHONE' and e.status == 'NEW' and e.activity_notes.count() == 1

    def test_missing_mobile_asks(self, seed_data, stu):
        assert 'error' in _run(seed_data, 'add_enquiry', child_name='Zain', father_name='Bilal')

    def test_duplicate_is_warned(self, seed_data, stu):
        _enquiry(stu, name='Zain Ali', mobile='0300-1112223')
        card = _card(_run(seed_data, 'add_enquiry', child_name='Zain Ali', father_name='Bilal', mobile='0300-1112223'))
        assert any('already exists' in w for w in card.preview['warnings'])

    def test_note(self, seed_data, stu):
        e = _enquiry(stu)
        _approve(_card(_run(seed_data, 'add_enquiry_note', enquiry_id=e.id, note='Father will visit Monday', was_a_call=True)), seed_data)
        n = e.activity_notes.get(note_type='CALL')
        assert n.note == 'Father will visit Monday'

    def test_status_change_and_converted_refused(self, seed_data, stu):
        e = _enquiry(stu)
        _approve(_card(_run(seed_data, 'change_enquiry_status', enquiry_id=e.id, status='CONFIRMED')), seed_data)
        e.refresh_from_db()
        assert e.status == 'CONFIRMED'
        e.status = 'CONVERTED'; e.save()
        assert 'error' in _run(seed_data, 'change_enquiry_status', enquiry_id=e.id, status='CANCELLED')

    def test_convert_needs_a_confirmed_enquiry(self, seed_data, stu):
        e = _enquiry(stu, 'NEW')
        out = _run(seed_data, 'convert_enquiry', enquiry_id=e.id, class_name=stu['sec_a'].display_name, section='A')
        assert 'error' in out and 'Confirmed' in out['error']

    def test_convert_creates_student_and_enrolment(self, seed_data, stu):
        from academic_sessions.models import StudentEnrollment
        from students.models import Student
        e = _enquiry(stu, 'CONFIRMED')
        card = _card(_run(seed_data, 'convert_enquiry', enquiry_id=e.id, class_name=stu['sec_a'].display_name, section='A'))
        assert not Student.objects.filter(name='Zain Ali').exists()
        _approve(card, seed_data)
        e.refresh_from_db()
        s = Student.objects.get(name='Zain Ali')
        assert e.status == 'CONVERTED' and e.converted_student_id == s.id
        assert StudentEnrollment.objects.filter(student=s, session_class=stu['sec_a'], is_active=True).exists()

    def test_teacher_cannot_write_enquiries(self, seed_data, stu):
        assert 'error' in _run(seed_data, 'add_enquiry', 'teacher', child_name='A', father_name='B', mobile='1')

    def test_unclear_name_asks_which(self, seed_data, stu):
        _enquiry(stu, name='Zain Ali', mobile='1'); _enquiry(stu, name='Zain Khan', mobile='2')
        out = _run(seed_data, 'add_enquiry_note', child_name='Zain', note='x')
        assert 'error' in out and 'enquiry_id' in out['error']


class TestEditStudent:
    def test_rename_shows_before_after_and_saves_on_approve(self, seed_data, stu):
        card = _card(_run(seed_data, 'update_student', student_id=stu['a'].id, name='Ali Hasan Raza'))
        assert card.preview['rows'][0]['field'] == 'Name' and any('report cards' in w for w in card.preview['warnings'])
        stu['a'].refresh_from_db()
        assert stu['a'].name != 'Ali Hasan Raza'
        _approve(card, seed_data)
        stu['a'].refresh_from_db()
        assert stu['a'].name == 'Ali Hasan Raza'

    def test_guardian_phone(self, seed_data, stu):
        _approve(_card(_run(seed_data, 'update_student', 'principal', student_id=stu['a'].id, guardian_phone='0300-7654321')), seed_data, 'principal')
        stu['a'].refresh_from_db()
        assert stu['a'].guardian_phone == '0300-7654321'

    def test_empty_name_refused(self, seed_data, stu):
        assert 'error' in _run(seed_data, 'update_student', student_id=stu['a'].id, name=' ')

    def test_class_and_status_are_not_editable_here(self, seed_data, stu):
        props = registry.get_tool('update_student').parameters['properties']
        assert 'class_obj' not in props and 'status' not in props and 'roll_number' not in props

    def test_teacher_outside_scope_refused(self, seed_data, stu):
        assert 'error' in _run(seed_data, 'update_student', 'teacher', student_id=stu['a'].id, address='x')


class TestReclassify:
    def test_move_to_other_section(self, seed_data, stu):
        from academic_sessions.models import StudentEnrollment
        card = _card(_run(seed_data, 'reclassify_student', student_id=stu['a'].id, class_name=stu['sec_a'].display_name, section='B', reason='Timetable clash'))
        assert any(r['field'] == 'To' for r in card.preview['rows'])
        assert StudentEnrollment.objects.get(student=stu['a'], is_active=True).session_class_id == stu['sec_a'].id
        _approve(card, seed_data)
        assert StudentEnrollment.objects.get(student=stu['a'], is_active=True).session_class_id == stu['sec_b'].id

    def test_reason_is_required(self, seed_data, stu):
        assert 'error' in _run(seed_data, 'reclassify_student', student_id=stu['a'].id, class_name=stu['sec_a'].display_name, section='B')

    def test_same_section_refused(self, seed_data, stu):
        out = _run(seed_data, 'reclassify_student', student_id=stu['a'].id, class_name=stu['sec_a'].display_name, section='A', reason='x')
        assert 'error' in out and 'already' in out['error']

    def test_only_admins(self, seed_data, stu):
        assert 'error' in _run(seed_data, 'reclassify_student', 'teacher', student_id=stu['a'].id, class_name=stu['sec_a'].display_name, section='B', reason='x')

    def test_no_promotion_or_exit_tools_exist(self, seed_data, stu):
        names = {t.name for t in registry.all_tools() if t.sub_agent == 'students'}
        assert not [n for n in names if any(w in n for w in ('promote', 'transfer', 'withdraw', 'delete', 'exit', 'batch'))]


class TestFees:
    def test_set_and_clear_monthly_override(self, seed_data, stu):
        from finance.models import FeeStructure
        _approve(_card(_run(seed_data, 'set_student_monthly_fee', student_id=stu['a'].id, amount=3000)), seed_data)
        fs = FeeStructure.objects.get(student=stu['a'], is_active=True)
        assert float(fs.monthly_amount) == 3000
        _approve(_card(_run(seed_data, 'set_student_monthly_fee', 'principal', student_id=stu['a'].id, amount=3500)), seed_data, 'principal')
        assert [float(f.monthly_amount) for f in FeeStructure.objects.filter(student=stu['a'], is_active=True)] == [3500.0]
        _approve(_card(_run(seed_data, 'clear_student_monthly_fee', student_id=stu['a'].id)), seed_data)
        assert not FeeStructure.objects.filter(student=stu['a'], is_active=True).exists()

    def test_same_amount_refused_and_clear_without_override_refused(self, seed_data, stu):
        assert 'error' in _run(seed_data, 'clear_student_monthly_fee', student_id=stu['a'].id)

    def test_discount_assign_and_remove(self, seed_data, stu):
        from finance.models import Discount, StudentDiscount
        Discount.objects.create(school=stu['school'], academic_year=stu['year'], name='Sibling discount', discount_type='PERCENTAGE', value=10)
        _approve(_card(_run(seed_data, 'assign_student_discount', student_id=stu['a'].id, discount_name='sibling')), seed_data)
        assert StudentDiscount.objects.filter(student=stu['a'], is_active=True).count() == 1
        assert 'error' in _run(seed_data, 'assign_student_discount', student_id=stu['a'].id, discount_name='sibling')
        _approve(_card(_run(seed_data, 'remove_student_discount', student_id=stu['a'].id, discount_name='sibling')), seed_data)
        assert not StudentDiscount.objects.filter(student=stu['a'], is_active=True).exists()

    def test_unknown_discount_lists_real_ones(self, seed_data, stu):
        out = _run(seed_data, 'assign_student_discount', student_id=stu['a'].id, discount_name='nope')
        assert 'error' in out

    def _fee(self, stu, who='a', paid=0, month=9, year=2026, due=2000):
        from finance.models import FeePayment
        fp = FeePayment.objects.create(school=stu['school'], student=stu[who], fee_type='MONTHLY', month=month, year=year, amount_due=due,
                                       academic_year=stu['year'])
        if paid:        # straight to the table: a real payment needs an account and a date
            FeePayment.objects.filter(pk=fp.pk).update(amount_paid=paid, status='PARTIAL')
        return fp

    def test_change_pending_month(self, seed_data, stu):
        fp = self._fee(stu)
        card = _card(_run(seed_data, 'change_pending_fee', student_id=stu['a'].id, month=9, year=2026, new_amount=2500))
        assert card.preview['rows'][1]['to'] == '+Rs 500'
        _approve(card, seed_data)
        fp.refresh_from_db()
        assert float(fp.amount_due) == 2500

    def test_month_with_a_payment_is_refused(self, seed_data, stu):
        self._fee(stu, paid=500)
        out = _run(seed_data, 'change_pending_fee', student_id=stu['a'].id, month=9, year=2026, new_amount=2500)
        assert 'error' in out and 'payment' in out['error']

    def test_missing_month_is_refused(self, seed_data, stu):
        assert 'error' in _run(seed_data, 'change_pending_fee', student_id=stu['a'].id, month=1, year=2026, new_amount=1)

    def test_finance_manager_and_teacher_cannot_edit_fees(self, seed_data, stu):
        for uname in ('finance_manager', 'teacher'):
            assert 'error' in _run(seed_data, 'set_student_monthly_fee', uname, student_id=stu['a'].id, amount=1)
