"""Item 4: sending messages to parents (with a preview card), Aura for parents (read-only), and the Study Helper extras."""
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _all_agents_offered():
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


@pytest.fixture
def fam(seed_data, seed_sections):
    from parents.models import ParentChild, ParentProfile
    from schools.models import UserSchoolMembership
    from users.models import User

    school, year = seed_data['school_a'], seed_data['academic_year']
    mods = {m: True for m in ('students', 'notifications', 'parents', 'attendance', 'finance')}
    school.enabled_modules = {**(school.enabled_modules or {}), **mods}
    school.save(update_fields=['enabled_modules'])
    org = school.organization
    org.allowed_modules = {**(org.allowed_modules or {}), **mods}
    org.save(update_fields=['allowed_modules'])
    year.is_current = True
    year.start_date, year.end_date = date(2020, 1, 1), date(2099, 12, 31)
    year.save()

    def parent(name, kids):
        u = User.objects.create_user(username=f'PYTEST_parent_{name}', email=f'{name}@test.com', password='x', role='PARENT', school=school,
                                     organization=org, first_name=name.title())
        UserSchoolMembership.objects.create(user=u, school=school, role='PARENT', is_default=True)
        prof = ParentProfile.objects.create(user=u, phone='0300' + str(abs(hash(name)))[:7])
        for k in kids:
            ParentChild.objects.create(parent=prof, student=k, school=school)
        return u

    a, a2 = seed_sections['a_students'][0], seed_sections['a_students'][1]
    b = seed_sections['b_students'][0]
    return {'school': school, 'a': a, 'a2': a2, 'b': b, 'sec_a': seed_sections['section_a'], 'sec_b': seed_sections['section_b'],
            'p1': parent('one', [a, a2]), 'p2': parent('two', [b])}


def _ctx(seed, user):
    return registry.ToolContext(user=user, school_id=seed['SID_A'], role=user.role)


def _run(seed, tool, uname='admin', user=None, **args):
    ctx = _ctx(seed, user or seed['users'][uname])
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=ctx.user)
    return registry.execute(ctx, tool, args)


def _card(out):
    assert 'proposal' in out, out
    return AgentAction.objects.get(pk=out['proposal']['action_id'])


def _approve(card, seed, uname='admin'):
    return engine.approve(card.id, seed['users'][uname], seed['SID_A'])


class TestSendMessages:
    def test_class_message_card_shows_audience_and_text_and_sends_nothing(self, seed_data, fam):
        from notifications.models import NotificationLog
        card = _card(_run(seed_data, 'send_message_to_parents', title='Holiday', body='School is closed on Monday.', class_name=fam['sec_a'].display_name, section='A'))
        rows = {r['field']: r['value'] for r in card.preview['rows']}
        assert card.preview['kind'] == 'parent_message' and '(1)' in rows['To'] and rows['Message'] == 'School is closed on Monday.'
        assert not NotificationLog.objects.exists()

    def test_approve_sends_in_app_to_the_parent(self, seed_data, fam):
        from notifications.models import NotificationLog
        card = _card(_run(seed_data, 'send_message_to_parents', title='Holiday', body='Closed Monday.', class_name=fam['sec_a'].display_name, section='A'))
        out = _approve(card, seed_data)
        log = NotificationLog.objects.get()
        assert log.recipient_user_id == fam['p1'].id and log.channel == 'IN_APP' and log.body == 'Closed Monday.'

    def test_one_students_parents(self, seed_data, fam):
        from notifications.models import NotificationLog
        _approve(_card(_run(seed_data, 'send_message_to_parents', title='Fee', body='Please pay.', event_type='FEE_DUE', student_id=fam['b'].id)), seed_data)
        assert [l.recipient_user_id for l in NotificationLog.objects.all()] == [fam['p2'].id]

    def test_all_parents_is_flagged_school_wide(self, seed_data, fam):
        card = _card(_run(seed_data, 'send_message_to_parents', title='Hi', body='Hello all.', all_parents=True))
        assert card.preview['rows'][0]['value'].startswith('ALL parents') and any('school-wide' in w for w in card.preview['warnings'])

    def test_reworded_text_replaces_the_card(self, seed_data, fam):
        card = _card(_run(seed_data, 'send_message_to_parents', title='Hi', body='Hello all.', all_parents=True))
        engine.edit(card.id, seed_data['users']['admin'], seed_data['SID_A'], {'body': 'Hello everyone, school opens at 8.'})
        card.refresh_from_db()
        assert any(r['value'] == 'Hello everyone, school opens at 8.' for r in card.preview['rows'])

    def test_audience_and_text_are_required(self, seed_data, fam):
        assert 'error' in _run(seed_data, 'send_message_to_parents', title='x', body='y')
        assert 'error' in _run(seed_data, 'send_message_to_parents', title='x', body='y', all_parents=True, class_name='5')
        assert 'error' in _run(seed_data, 'send_message_to_parents', title='x', all_parents=True)

    def test_no_parent_accounts_is_refused(self, seed_data, fam):
        st = seed_data['students'][5]
        assert 'error' in _run(seed_data, 'send_message_to_parents', title='x', body='y', student_id=st.id)

    def test_push_only_in_app_and_push(self, seed_data, fam):
        assert 'error' in _run(seed_data, 'send_message_to_parents', title='x', body='y', all_parents=True, channel='EMAIL')

    def test_daily_cap(self, seed_data, fam):
        user = seed_data['users']['admin']
        for i in range(10):
            AgentAction.objects.create(school_id=seed_data['SID_A'], user=user, sub_agent='communication', tool_name='send_message_to_parents',
                                       status='executed', idempotency_key=f'k{i}', expires_at=timezone.now() + timedelta(hours=1))
        out = _run(seed_data, 'send_message_to_parents', title='x', body='y', all_parents=True)
        assert 'error' in out and 'daily limit' in out['error']

    def test_teachers_and_accountants_cannot_send(self, seed_data, fam):
        for u in ('teacher', 'accountant'):
            assert 'error' in _run(seed_data, 'send_message_to_parents', u, title='x', body='y', all_parents=True)

    def test_recent_messages(self, seed_data, fam):
        _approve(_card(_run(seed_data, 'send_message_to_parents', title='Fee', body='Pay.', student_id=fam['b'].id)), seed_data)
        out = _run(seed_data, 'list_recent_messages', student_id=fam['b'].id)['data']
        assert out['count'] == 1 and out['messages'][0]['title'] == 'Fee'


class TestParents:
    def test_children_list_only_their_own(self, seed_data, fam):
        out = _run(seed_data, 'get_my_children', user=fam['p1'])['data']['children']
        assert {c['child_id'] for c in out} == {fam['a'].id, fam['a2'].id}

    def test_several_children_asks_which(self, seed_data, fam):
        out = _run(seed_data, 'get_child_attendance', user=fam['p1'])
        assert 'error' in out and 'Which child' in out['error']

    def test_single_child_needs_no_question(self, seed_data, fam):
        out = _run(seed_data, 'get_child_attendance', user=fam['p2'])
        assert 'data' in out and out['data']['child'] == fam['b'].name

    def test_another_parents_child_is_refused(self, seed_data, fam):
        out = _run(seed_data, 'get_child_overview', user=fam['p2'], child_id=fam['a'].id)
        assert 'error' in out and 'not linked' in out['error']

    def test_overview_and_fees_work_for_own_child(self, seed_data, fam):
        assert 'error' not in _run(seed_data, 'get_child_overview', user=fam['p2'], child_id=fam['b'].id)
        assert 'error' not in _run(seed_data, 'get_child_fees', user=fam['p2'], child_id=fam['b'].id)

    def test_parent_has_no_write_tools_and_no_staff_tools(self, seed_data, fam):
        ctx = _ctx(seed_data, fam['p1'])
        tools = registry.tools_for(ctx)
        assert tools and all(t.kind == 'read' and t.sub_agent == 'family' for t in tools if not t.shared)
        assert 'error' in _run(seed_data, 'send_message_to_parents', user=fam['p1'], title='x', body='y', all_parents=True)
        assert 'error' in _run(seed_data, 'list_staff', user=fam['p1'])

    def test_staff_cannot_use_parent_tools(self, seed_data, fam):
        assert 'error' in _run(seed_data, 'get_my_children', 'admin')

    def test_parent_guard_prompt_and_daily_cap(self, seed_data, fam):
        from assistant import guards
        assert 'PARENT' in guards.ROLE_PROMPTS
        conv = AgentConversation.objects.create(school_id=seed_data['SID_A'], user=fam['p1'])
        from assistant.models import AgentMessage
        AgentMessage.objects.bulk_create([AgentMessage(conversation=conv, role=AgentMessage.Role.USER, content='hi') for _ in range(guards.PARENT_DAILY_MESSAGES)])
        with pytest.raises(guards.GuardRefusal):
            guards.check_input(_ctx(seed_data, fam['p1']), 'one more')


MARKS = {'marks': [
    {'exam': 'Mid', 'subject': 'Maths', 'percentage': 40, 'is_pass': True, 'is_absent': False},
    {'exam': 'Mid', 'subject': 'Urdu', 'percentage': 85, 'is_pass': True, 'is_absent': False},
    {'exam': 'Mid', 'subject': 'Science', 'percentage': 70, 'is_pass': True, 'is_absent': False},
    {'exam': 'Quiz', 'subject': 'Science', 'percentage': 82, 'is_pass': True, 'is_absent': False},     # newest first: Science fell 12 points
    {'exam': 'Mid', 'subject': 'Urdu', 'percentage': 80, 'is_pass': True, 'is_absent': False},
]}


class FakeService:
    def __init__(self, papers=None):
        today = timezone.localdate()
        self.papers = papers if papers is not None else [{'name': 'Final', 'start_date': str(today + timedelta(days=5)), 'subjects': [
            {'subject': 'Maths', 'date': str(today + timedelta(days=3))}, {'subject': 'Urdu', 'date': str(today + timedelta(days=5))}]}]

    def _execute_tool(self, name, params):
        return {'get_my_marks': MARKS, 'get_exam_schedule': {'upcoming_exams': self.papers},
                'get_topic_details': {'books': [{'title': 'Maths 5', 'subject': 'Maths', 'chapters': [
                    {'chapter_number': 1, 'title': 'Fractions', 'topics': [{'title': 'Adding'}]},
                    {'chapter_number': 2, 'title': 'Decimals', 'topics': [{'title': 'Place value'}]}]}]}}[name]


class TestStudyExtras:
    def _run_study(self, seed, tool, svc=None, **args):
        user = seed['users']['staff']
        user.role = 'STUDENT'
        ctx = registry.ToolContext(user=user, school_id=seed['SID_A'], role='STUDENT')
        ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=ctx.user)
        with patch('assistant.skills.study_extras._service', lambda c: svc or FakeService()):
            return registry.execute(ctx, tool, args)

    def test_weak_subjects_ranked_with_trend(self, seed_data):
        out = self._run_study(seed_data, 'get_weak_subjects')['data']
        names = [s['subject'] for s in out['weakest_first']]
        assert names[0] == 'Maths' and out['weak'][0] == 'Maths'
        science = next(s for s in out['weakest_first'] if s['subject'] == 'Science')
        assert science['change_since_previous'] == -12.0 and science['falling'] is True and 'Science' in out['weak']

    def test_revision_plan_follows_the_dates_and_favours_the_weak_subject(self, seed_data):
        out = self._run_study(seed_data, 'make_revision_plan', minutes_per_day=120)['data']
        first = out['plan'][0]
        by = {s['subject']: s['minutes'] for s in first['study']}
        assert by['Maths'] > by['Urdu'] and sum(by.values()) <= 125
        assert [p['subject'] for p in out['papers']] == ['Maths', 'Urdu']
        assert len(out['plan']) == 5            # the last study day is the day before the last paper

    def test_a_subject_drops_out_after_its_paper(self, seed_data):
        out = self._run_study(seed_data, 'make_revision_plan')['data']
        day4 = out['plan'][3]
        assert [s['subject'] for s in day4['study']] == ['Urdu']

    def test_no_dates_is_explained(self, seed_data):
        out = self._run_study(seed_data, 'make_revision_plan', svc=FakeService(papers=[]))['data']
        assert out['plan'] == [] and 'date sheet' in out['note']

    def test_bad_minutes_refused(self, seed_data):
        assert 'error' in self._run_study(seed_data, 'make_revision_plan', minutes_per_day=5)

    def test_quiz_material_by_chapter(self, seed_data):
        out = self._run_study(seed_data, 'get_quiz_material', subject='maths', chapter_number=2)['data']
        assert [c['title'] for c in out['books'][0]['chapters']] == ['Decimals'] and 'Do not show answers' in out['how_to_use']

    def test_study_tools_are_students_only(self, seed_data, fam):
        assert 'error' in _run(seed_data, 'get_weak_subjects', 'admin')
        assert 'error' in _run(seed_data, 'make_revision_plan', user=fam['p1'])
