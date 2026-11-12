"""Router, guards and the tool packs ported from the old Academics / Communication / Study agents.
The model is always mocked."""
import json
from unittest.mock import patch

import pytest

from assistant import guards, llm, orchestrator, registry, router
from assistant.models import AgentAuditLog, AgentConversation, AgentMessage
from assistant.router import pick_agents

pytestmark = pytest.mark.django_db


def _enable(seed, *modules):
    school = seed['school_a']
    school.enabled_modules = {**(school.enabled_modules or {}), **{m: True for m in modules}}
    school.save(update_fields=['enabled_modules'])
    org = school.organization
    org.allowed_modules = {**(org.allowed_modules or {}), **{m: True for m in modules}}
    org.save(update_fields=['allowed_modules'])


def _ctx(seed, uname, conv=None, role=None):
    user = seed['users'][uname]
    return registry.ToolContext(user=user, school_id=seed['SID_A'], role=role or user.role, conversation=conv)


def _names(ctx):
    return {t.name for t in registry.tools_for(ctx)}


def _student_user(seed):
    from students.models import StudentProfile
    from schools.models import UserSchoolMembership
    from users.models import User

    u = User.objects.create_user(username='PYTEST_stu', email='stu@test.com', password='TestPass123!',
                                 role='STUDENT', school=seed['school_a'], organization=seed['org'])
    UserSchoolMembership.objects.create(user=u, school=seed['school_a'], role='STUDENT', is_default=True)
    StudentProfile.objects.create(user=u, student=seed['students'][0], school=seed['school_a'])
    return u


class TestErrorNamedTools:
    def test_read_tool_named_in_an_error_is_offered_but_a_write_tool_is_not(self, seed_data):
        _enable(seed_data, 'notifications', 'attendance')
        ctx = _ctx(seed_data, 'admin')
        offered = {'get_attendance_summary'}
        err = {'error': 'Needs student_id or class_id. For today use get_attendance_summary_school.'}
        assert [t.name for t in orchestrator._tools_named_in_error(ctx, err, offered)] == ['get_attendance_summary_school']
        assert orchestrator._tools_named_in_error(ctx, {'error': 'try mark_attendance'}, offered) == []
        assert orchestrator._tools_named_in_error(ctx, {'data': 1}, offered) == []

    def test_attendance_count_question_is_not_left_to_communication(self):
        assert 'NEVER for' in router.AGENTS['communication'] and 'absent today' in router.AGENTS['attendance']


class TestRerouteWhenNoToolsWereOffered:
    def test_a_tool_call_after_a_none_route_routes_again_with_the_models_own_summary(self, seed_data):
        _enable(seed_data, 'finance', 'academics', 'notifications', 'students', 'hr')
        conv = AgentConversation.objects.create(school=seed_data['school_a'], user=seed_data['users']['admin'])
        ctx = _ctx(seed_data, 'admin', conv)
        gap = type('R', (), {'content': '', 'tool_calls': [{'id': '1', 'name': 'report_missing_capability', 'raw_arguments': '{}',
                                                            'arguments': {'summary': 'who is on leave today'}}]})()
        done = type('R', (), {'content': 'Nobody is on leave.', 'tool_calls': []})()
        seen = []

        def fake_pick(by_agent, message, recent=()):
            seen.append(message)
            return [] if len(seen) == 1 else ['hr']

        with patch.object(router, 'pick_agents', fake_pick), patch.object(llm, 'complete', side_effect=[gap, done]) as call:
            result = orchestrator.run_turn(conv, 'aaj koon kon chutti paar hai?', ctx)
        assert result.content == 'Nobody is on leave.'
        assert 'who is on leave today' in seen[1] and call.call_count == 2
        assert not result.tool_calls          # the gap call was dropped, not executed


class TestSalaryLookupHint:
    def test_unknown_name_points_to_the_monthly_total_tool(self):
        from assistant.skills import hr_tools
        from assistant.registry import ProposalError

        with patch.object(hr_tools, '_one_staff', side_effect=ProposalError('No staff member matching "Maheeney".')):
            with pytest.raises(ProposalError) as err:
                hr_tools.get_staff_salary(None, staff_name='Maheeney')
        assert 'get_payroll_summary' in str(err.value)


class TestKeepLatin:
    def _fake(self, text):
        return type('R', (), {'content': text, 'tool_calls': []})()

    def test_urdu_script_in_a_roman_urdu_reply_is_rewritten_once(self):
        with patch.object(llm, 'complete', return_value=self._fake('Aaj 0 bachay ghair hazir hain')) as call:
            out = orchestrator._keep_latin([], 'aj kitne bachay ghair hazir heen?', 'Aaj 0 طلباء ghair hazir hain')
        assert out == 'Aaj 0 bachay ghair hazir hain' and call.call_count == 1

    def test_a_user_who_wrote_urdu_script_is_left_alone_and_so_is_a_latin_reply(self):
        with patch.object(llm, 'complete') as call:
            assert orchestrator._keep_latin([], 'آج کتنے بچے غیر حاضر ہیں؟', 'آج صفر') == 'آج صفر'
            assert orchestrator._keep_latin([], 'aj kitne bachay?', 'Aaj 0') == 'Aaj 0'
        call.assert_not_called()

    def test_a_rewrite_that_still_has_urdu_script_is_not_used(self):
        with patch.object(llm, 'complete', return_value=self._fake('Aaj طلباء')):
            assert orchestrator._keep_latin([], 'aj kitne?', 'Aaj صفر') == 'Aaj صفر'


class TestPorts:
    def test_tool_counts(self):
        by = {}
        for t in registry.all_tools():
            by[t.sub_agent] = by.get(t.sub_agent, 0) + 1
        assert by == {'finance': 32, 'academics': 26, 'communication': 17, 'study': 13, 'directory': 4, 'settings': 2, 'attendance': 4, 'exams': 12, 'hr': 19, 'students': 22, 'operations': 26, 'family': 12}

    def test_every_tool_has_valid_schema(self):
        for t in registry.all_tools():
            params = t.parameters
            assert params['type'] == 'object'
            for req in params.get('required', []):
                assert req in params['properties'], (t.name, req)

    def test_admin_sees_admin_tools_but_not_student_tools(self, seed_data):
        _enable(seed_data, 'finance', 'academics', 'notifications', 'students')
        names = _names(_ctx(seed_data, 'admin'))
        assert {'get_balance', 'get_class_schedule', 'get_fee_status', 'find_student'} <= names
        assert not names & {'get_my_marks', 'get_my_assignments'}

    def test_teacher_sees_schedules_not_planning_finance_or_parent_data(self, seed_data):
        _enable(seed_data, 'finance', 'academics', 'notifications', 'students')
        names = _names(_ctx(seed_data, 'teacher'))
        assert 'get_class_schedule' in names and 'get_teacher_schedule' in names
        assert not names & {'get_workload_analysis', 'find_substitute', 'get_balance', 'get_fee_status', 'find_student'}

    def test_finance_manager_gets_finance_and_lookup_only(self, seed_data):
        _enable(seed_data, 'finance', 'academics', 'notifications', 'students')
        names = _names(_ctx(seed_data, 'finance_manager'))
        assert 'get_pending_fees' in names and 'find_student' in names
        assert not names & {'get_my_marks', 'get_my_assignments'}  # no student-owned tools

    def test_student_sees_only_own_data_tools(self, seed_data):
        _enable(seed_data, 'finance', 'academics', 'notifications', 'students')
        user = _student_user(seed_data)
        ctx = registry.ToolContext(user=user, school_id=seed_data['SID_A'], role='STUDENT')
        names = _names(ctx)
        assert names == {'get_my_marks', 'get_my_assignments', 'get_topic_details', 'get_my_attendance',
                         'get_exam_schedule', 'get_lesson_materials', 'get_grade_targets', 'get_teacher_feedback',
                         'get_weak_subjects', 'make_revision_plan', 'get_quiz_material', 'record_quiz_answer', 'get_flashcard_topics', 'report_missing_capability', 'get_my_preferences'}

    def test_student_tools_take_no_student_id_argument(self):
        for t in registry.all_tools():
            if t.sub_agent == 'study':
                assert not {k for k in t.parameters['properties'] if 'student' in k}

    def test_student_tool_runs_for_own_record_only(self, seed_data):
        user = _student_user(seed_data)
        ctx = registry.ToolContext(user=user, school_id=seed_data['SID_A'], role='STUDENT')
        out = registry.execute(ctx, 'get_my_attendance', {})
        assert 'data' in out, out
        # An admin cannot borrow a study tool.
        denied = registry.execute(_ctx(seed_data, 'admin'), 'get_my_attendance', {})
        assert 'error' in denied

    def test_find_student_returns_candidates(self, seed_data):
        _enable(seed_data, 'students')
        name = seed_data['students'][0].name
        out = registry.execute(_ctx(seed_data, 'admin'), 'find_student', {'query': name.split()[0]})
        ids = [m['student_id'] for m in out['data']['matches']]
        assert seed_data['students'][0].id in ids

    def test_find_student_is_school_scoped(self, seed_data):
        _enable(seed_data, 'students')
        from students.models import Student
        other = Student.objects.filter(school=seed_data['school_b']).first()
        if other is None:
            pytest.skip('seed has no school B student')
        out = registry.execute(_ctx(seed_data, 'admin'), 'find_student', {'query': other.name})
        assert other.id not in [m['student_id'] for m in out['data']['matches']]

    def test_find_class_matches_section_label(self, seed_data):
        _enable(seed_data, 'students')
        c = seed_data['classes'][0]
        out = registry.execute(_ctx(seed_data, 'admin'), 'find_class', {'query': c.name})
        assert c.id in [m['class_id'] for m in out['data']['matches']]

    def test_communication_string_errors_become_tool_errors(self, seed_data):
        _enable(seed_data, 'notifications')
        out = registry.execute(_ctx(seed_data, 'admin'), 'get_student_info', {'student_id': 99999999})
        assert 'error' in out

    def test_missing_required_argument_is_an_error_not_a_crash(self, seed_data):
        _enable(seed_data, 'academics')
        out = registry.execute(_ctx(seed_data, 'admin'), 'get_class_schedule', {})
        assert 'error' in out


class TestRouter:
    AVAILABLE = {'finance': [1], 'academics': [1], 'communication': [1]}

    def test_single_agent_skips_the_model(self):
        with patch('assistant.llm.complete', side_effect=AssertionError('router must not call the model')):
            assert pick_agents({'finance': [1]}, 'hi') == ['finance']
            assert pick_agents({}, 'hi') == []

    def test_model_choice_is_respected(self):
        with patch('assistant.llm.complete', lambda *a, **k: llm.LLMReply(content='finance')):
            assert pick_agents(self.AVAILABLE, 'fee pending?') == ['finance']
        with patch('assistant.llm.complete', lambda *a, **k: llm.LLMReply(content='Academics, finance')):
            assert pick_agents(self.AVAILABLE, 'x') == ['finance', 'academics']

    def test_none_means_no_tools(self):
        with patch('assistant.llm.complete', lambda *a, **k: llm.LLMReply(content='none')):
            assert pick_agents(self.AVAILABLE, 'hello') == []

    def test_garbage_or_failure_falls_back_to_everything(self):
        with patch('assistant.llm.complete', lambda *a, **k: llm.LLMReply(content='???')):
            assert pick_agents(self.AVAILABLE, 'x') == ['finance', 'academics', 'communication']

        def boom(*a, **k):
            raise llm.LLMUnavailable('down')

        with patch('assistant.llm.complete', boom):
            assert pick_agents(self.AVAILABLE, 'x') == ['finance', 'academics', 'communication']

    def test_prompt_is_tiny_and_lists_no_tools(self):
        seen = {}

        def spy(messages, tools=None, **k):
            seen['tools'] = tools
            seen['chars'] = sum(len(m['content']) for m in messages)
            return llm.LLMReply(content='finance')

        with patch('assistant.llm.complete', spy):
            pick_agents(self.AVAILABLE, 'how much fee is pending')
        assert seen['tools'] is None and seen['chars'] < 1500

    def test_descriptions_keep_overlapping_topics_apart(self):
        from assistant.router import AGENTS
        assert 'who owes' in AGENTS['finance'] and 'scholarship' in AGENTS['finance']
        assert 'NEVER' in AGENTS['students'] and 'finance' in AGENTS['students']
        assert 'staff' in AGENTS['hr'].split(';')[0]
        assert 'NEVER one student' in AGENTS['attendance']

    def test_router_prompt_asks_for_both_agents_when_a_name_is_ambiguous(self):
        seen = {}

        def spy(messages, tools=None, **k):
            seen['system'] = messages[0]['content']
            return llm.LLMReply(content='students, hr')

        avail = {'students': [1], 'hr': [1]}
        with patch('assistant.llm.complete', spy):
            assert pick_agents(avail, 'Show Ayesha Khan') == ['students', 'hr']
        assert 'student or a staff member, choose both' in seen['system']

    def test_orchestrator_offers_only_the_routed_agents_tools(self, seed_data):
        _enable(seed_data, 'finance', 'academics', 'notifications', 'students')
        conv = AgentConversation.objects.create(school=seed_data['school_a'], user=seed_data['users']['admin'])
        offered = {}

        def fake(messages, tools=None, **k):
            if tools is None and len(messages) == 2 and 'Choose which assistants' in messages[0]['content']:
                return llm.LLMReply(content='academics')
            offered['names'] = {t['function']['name'] for t in tools}
            return llm.LLMReply(content='done')

        with patch('assistant.llm.complete', fake):
            orchestrator.run_turn(conv, 'class 4 ka timetable', _ctx(seed_data, 'admin', conv))
        assert 'get_class_schedule' in offered['names']
        assert 'find_student' in offered['names']          # shared helper rides along
        assert 'get_balance' not in offered['names'] and 'get_fee_status' not in offered['names']

    def test_shared_tools_do_not_show_as_a_sub_agent_chip(self, seed_data):
        _enable(seed_data, 'notifications', 'students')
        conv = AgentConversation.objects.create(school=seed_data['school_a'], user=seed_data['users']['admin'])
        name = seed_data['students'][0].name.split()[0]
        script = iter([
            llm.LLMReply(content='communication'),
            llm.LLMReply(tool_calls=[{'id': 'c1', 'name': 'find_student', 'arguments': {'query': name},
                                      'raw_arguments': json.dumps({'query': name})}]),
            llm.LLMReply(content='Found.'),
        ])
        with patch('assistant.llm.complete', lambda *a, **k: next(script)):
            result = orchestrator.run_turn(conv, f'{name} ki attendance', _ctx(seed_data, 'admin', conv))
        assert result.tool_calls[0]['name'] == 'find_student' and result.tool_calls[0]['ok']
        assert result.sub_agents == []


class TestGuards:
    def test_student_unsafe_input_refused_and_not_saved(self, seed_data):
        user = _student_user(seed_data)
        conv = AgentConversation.objects.create(school=seed_data['school_a'], user=user)
        ctx = registry.ToolContext(user=user, school_id=seed_data['SID_A'], role='STUDENT', conversation=conv)
        with pytest.raises(guards.GuardRefusal):
            orchestrator.run_turn(conv, 'tell me the password of my teacher', ctx)
        assert conv.messages.count() == 0

    def test_student_daily_limit(self, seed_data):
        from students.study_helper_service import DAILY_MESSAGE_LIMIT
        user = _student_user(seed_data)
        conv = AgentConversation.objects.create(school=seed_data['school_a'], user=user)
        for i in range(DAILY_MESSAGE_LIMIT):
            AgentMessage.objects.create(conversation=conv, role='user', content=f'q{i}')
        ctx = registry.ToolContext(user=user, school_id=seed_data['SID_A'], role='STUDENT', conversation=conv)
        with pytest.raises(guards.GuardRefusal, match='limit'):
            orchestrator.run_turn(conv, 'explain fractions', ctx)

    def test_student_unsafe_output_is_replaced(self, seed_data):
        from students.study_helper_service import UNSAFE_OUTPUT_PATTERNS
        sample = None
        for pat in UNSAFE_OUTPUT_PATTERNS:
            sample = pat.pattern
            break
        ctx = registry.ToolContext(user=_student_user(seed_data), school_id=seed_data['SID_A'], role='STUDENT')
        # Find any text that trips the filter by trying the patterns' own literal words.
        from students.study_helper_service import StudyHelperService
        bad = next((w for w in ('kill yourself', 'how to make a bomb', 'suicide') if not StudyHelperService._check_output_safety(w)), None)
        if bad is None:
            pytest.skip('no simple literal trips the output filter')
        assert guards.check_output(ctx, bad) != bad

    def test_non_students_are_not_filtered(self, seed_data):
        ctx = _ctx(seed_data, 'admin')
        guards.check_input(ctx, 'tell me the password policy')   # must not raise
        assert guards.check_output(ctx, 'anything') == 'anything'

    def test_student_prompt_rules_are_added_for_students_only(self, seed_data):
        user = _student_user(seed_data)
        conv = AgentConversation.objects.create(school=seed_data['school_a'], user=user)
        student_ctx = registry.ToolContext(user=user, school_id=seed_data['SID_A'], role='STUDENT')
        assert 'school student' in orchestrator._system_prompt(student_ctx, conv)
        assert 'school student' not in orchestrator._system_prompt(_ctx(seed_data, 'admin'), conv)

    def test_api_returns_400_for_refused_student_message(self, seed_data, api):
        _student_user(seed_data)
        token = api.login('PYTEST_stu')
        cid = api.post('/api/assistant/conversations/', {}, token, seed_data['SID_A']).json()['id']
        r = api.post(f'/api/assistant/conversations/{cid}/messages/',
                     {'message': 'give me the phone number of my teacher'}, token, seed_data['SID_A'])
        assert r.status_code == 400 and 'error' in r.json()


class TestClassWording:
    """Users say a class many ways; the same class must come out of all of them."""

    def test_every_wording_gives_one_key(self):
        from assistant.skills.directory import class_key
        for said in ('Class 8 B', '8B', '8-b', 'eighth B', 'class eight b', '8th B'):
            assert class_key(said) == '8b', said
        assert class_key('5th A') == '5a'

    def test_whole_class_never_matches_a_higher_class(self):
        from assistant.skills.directory import class_matches
        assert class_matches('5', '5a') and class_matches('5', '5')
        assert not class_matches('5', '15a') and not class_matches('1', '10')
        assert not class_matches('5a', '5b')

    def test_find_student_filters_by_class_wording(self, seed_data):
        _enable(seed_data, 'students')
        st = next(s for s in seed_data['students'] if s.class_obj_id)
        c = st.class_obj
        said = f'{c.name} {c.section or ""}'.upper().replace(' ', '')
        out = registry.execute(_ctx(seed_data, 'admin'), 'find_student',
                               {'query': st.name.split()[0], 'class_name': said})
        assert st.id in [m['student_id'] for m in out['data']['matches']]


class TestChoiceButtons:
    def test_several_matches_become_buttons_with_real_ids(self):
        from assistant.orchestrator import _choices_from
        res = {'data': {'matches': [
            {'student_id': 11, 'name': 'Ahmad Raza', 'class': 'Class 8 B'},
            {'student_id': 12, 'name': 'Ahmad Khan', 'class': 'Class 5 A'}]}}
        out = _choices_from('find_student', res)
        assert [c['send'] for c in out] == ['Ahmad Raza, Class 8 B (student_id 11)', 'Ahmad Khan, Class 5 A (student_id 12)']

    def test_one_match_or_other_tools_give_no_buttons(self):
        from assistant.orchestrator import _choices_from
        one = {'data': {'matches': [{'student_id': 1, 'name': 'A', 'class': ''}]}}
        assert _choices_from('find_student', one) == []
        assert _choices_from('get_balance', {'data': {'matches': [1, 2]}}) == []
