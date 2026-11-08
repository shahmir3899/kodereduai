"""Attendance through the assistant: reads (unmarked, class register, school summary) and
marking a register with preview -> approve through the real bulk_entry endpoint."""
from datetime import date
from unittest.mock import patch

import pytest

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation

pytestmark = pytest.mark.django_db

DAY = '2025-09-15'      # a Monday inside the seed academic year


@pytest.fixture(autouse=True)
def _all_agents_offered():
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


@pytest.fixture(autouse=True)
def _no_real_notifications():
    """bulk_entry fires the absence digest after a save; it is checked, not run, here."""
    with patch('attendance.views._run_absence_digest') as digest:
        yield digest


@pytest.fixture
def reg(seed_data, seed_sections):
    from academics.models import ClassTeacherAssignment
    from students.models import Student

    school = seed_data['school_a']
    school.enabled_modules = {**(school.enabled_modules or {}), 'attendance': True}
    school.save(update_fields=['enabled_modules'])
    org = school.organization
    org.allowed_modules = {**(org.allowed_modules or {}), 'attendance': True}
    org.save(update_fields=['allowed_modules'])

    names = ['Ahmad Khan', 'Akram Ali', 'Sara Noor', 'Bilal Shah']
    for st, n in zip(seed_sections['a_students'] + seed_sections['b_students'], names):
        Student.objects.filter(pk=st.pk).update(name=n)
    teacher = seed_data['staff'][0]
    ClassTeacherAssignment.objects.create(school=school, academic_year=seed_data['academic_year'],
                                          session_class=seed_sections['section_a'], class_obj=seed_sections['master'], teacher=teacher)
    return {**seed_sections, 'teacher': teacher, 'class_name': seed_sections['master'].name}


def _ctx(user):
    return registry.ToolContext(user=user, school_id=user.school_id, role=user.role)


def _admin(seed):
    return _ctx(seed['users']['admin'])


def _teacher(reg):
    return _ctx(reg['teacher'].user)


def _run(ctx, tool, **args):
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=ctx.user)
    return registry.execute(ctx, tool, args)


def _card(out):
    return AgentAction.objects.get(pk=out['proposal']['action_id'])


def _mark(ctx, reg, **extra):
    return _run(ctx, 'mark_attendance', **{'class_name': reg['class_name'], 'section': 'A', 'date': DAY, **extra})


def _records():
    from attendance.models import AttendanceRecord
    return {r.student.name: r.status for r in AttendanceRecord.objects.select_related('student')}


class TestMarking:
    def test_card_shows_the_whole_register_and_saves_nothing(self, seed_data, reg):
        card = _card(_mark(_teacher(reg), reg, absent_names=['Ahmad']))
        assert _records() == {}
        pv = card.preview
        assert pv['totals'] == {'count': 2, 'present': 1, 'absent': 1, 'leave': 0}
        assert {r['student']: r['status'] for r in pv['rows']} == {'Ahmad Khan': 'ABSENT', 'Akram Ali': 'PRESENT'}
        assert any('Parents of 1 absent' in w for w in pv['warnings'])

    def test_approve_saves_through_bulk_entry_and_triggers_the_absence_digest(self, seed_data, reg, _no_real_notifications):
        ctx = _teacher(reg)
        card = _card(_mark(ctx, reg, absent_names=['Ahmad']))
        done = engine.approve(card.id, ctx.user, ctx.school_id)
        assert done.status == 'executed' and done.result['saved'] == 2 and done.result['errors'] == []
        assert _records() == {'Ahmad Khan': 'ABSENT', 'Akram Ali': 'PRESENT'}
        from attendance.models import AttendanceRecord
        assert {r.source for r in AttendanceRecord.objects.all()} == {'MANUAL'}
        _no_real_notifications.assert_called_once()

    def test_leave_status(self, seed_data, reg):
        card = _card(_mark(_teacher(reg), reg, leave_names=['Akram']))
        assert {r['student']: r['status'] for r in card.preview['rows']}['Akram Ali'] == 'LEAVE'

    def test_rest_unchanged_only_touches_named_students(self, seed_data, reg):
        ctx = _teacher(reg)
        card = _card(_mark(ctx, reg, absent_names=['Ahmad'], rest='UNCHANGED'))
        assert card.preview['totals']['count'] == 1 and any('left untouched' in w for w in card.preview['warnings'])
        engine.approve(card.id, ctx.user, ctx.school_id)
        assert _records() == {'Ahmad Khan': 'ABSENT'}

    def test_rest_unchanged_without_names_asks(self, seed_data, reg):
        assert 'Ask the user' in _mark(_teacher(reg), reg, rest='UNCHANGED')['error']

    def test_correcting_an_existing_mark_shows_what_it_replaces(self, seed_data, reg):
        from attendance.models import AttendanceRecord
        ahmad = reg['a_students'][0]
        AttendanceRecord.objects.create(school=seed_data['school_a'], academic_year=seed_data['academic_year'], student=ahmad,
                                        date=date(2025, 9, 15), status='ABSENT', source='MANUAL')
        card = _card(_mark(_teacher(reg), reg, present_names=['Ahmad'], rest='UNCHANGED'))
        row = card.preview['rows'][0]
        assert (row['was'], row['status'], row['changed']) == ('ABSENT', 'PRESENT', True)
        assert any('existing mark' in w for w in card.preview['warnings'])
        engine.approve(card.id, _teacher(reg).user, seed_data['SID_A'])
        assert _records()['Ahmad Khan'] == 'PRESENT'

    def test_ambiguous_name_asks_and_unknown_name_lists_students(self, seed_data, reg):
        from students.models import Student
        Student.objects.filter(pk=reg['a_students'][1].pk).update(name='Ahmad Raza')
        out = _mark(_teacher(reg), reg, absent_names=['Ahmad'])
        assert 'Ask the user which one' in out['error']
        assert 'Ahmad Khan' in _mark(_teacher(reg), reg, absent_names=['Zubair'])['error']

    def test_misspelled_name_matches(self, seed_data, reg):
        card = _card(_mark(_teacher(reg), reg, absent_names=['Ahmed']))
        assert {r['student']: r['status'] for r in card.preview['rows']}['Ahmad Khan'] == 'ABSENT'

    def test_student_in_two_lists_is_a_question(self, seed_data, reg):
        assert 'Ask the user which is right' in _mark(_teacher(reg), reg, absent_names=['Ahmad'], leave_names=['Ahmad'])['error']

    def test_future_date_is_refused(self, seed_data, reg):
        assert 'future' in _mark(_teacher(reg), reg, date='2099-01-01')['error']

    def test_a_student_who_left_is_not_on_the_register(self, seed_data, reg):
        from academic_sessions.models import StudentEnrollment
        StudentEnrollment.objects.filter(student=reg['a_students'][1]).update(status='WITHDRAWN', is_active=False, left_date=date(2025, 9, 1))
        card = _card(_mark(_teacher(reg), reg))
        assert [r['student'] for r in card.preview['rows']] == ['Ahmad Khan']

    def test_missing_class_asks(self, seed_data, reg):
        assert 'Which class' in _run(_teacher(reg), 'mark_attendance')['error']


class TestRolesAndSections:
    def test_class_teacher_can_mark_only_their_own_section(self, seed_data, reg):
        out = _mark(_teacher(reg), reg, section='B')
        assert 'not the class teacher' in out['error']
        assert _records() == {}

    def test_admin_can_mark_any_section(self, seed_data, reg):
        card = _card(_mark(_admin(seed_data), reg, section='B'))
        assert {r['student'] for r in card.preview['rows']} == {'Sara Noor', 'Bilal Shah'}

    def test_several_sections_need_a_choice_for_admin(self, seed_data, reg):
        out = _run(_admin(seed_data), 'mark_attendance', class_name=reg['class_name'], date=DAY)
        assert 'several sections' in out['error'] and 'Ask the user which section' in out['error']

    def test_unassigned_teacher_cannot_mark_anything(self, seed_data, reg):
        other = _ctx(seed_data['staff'][1].user)
        assert 'not the class teacher' in _mark(other, reg)['error']

    def test_write_tool_visibility(self, seed_data, reg):
        for who, expected in [(_admin(seed_data), True), (_teacher(reg), True), (_ctx(seed_data['users']['accountant']), False),
                              (_ctx(seed_data['users']['manager']), False), (_ctx(seed_data['users']['staff']), False)]:
            assert ('mark_attendance' in {t.name for t in registry.tools_for(who)}) is expected, who.role

    def test_attendance_module_off_hides_everything(self, seed_data, reg):
        school = seed_data['school_a']
        school.enabled_modules = {**school.enabled_modules, 'attendance': False}
        school.save(update_fields=['enabled_modules'])
        assert not [t for t in registry.tools_for(_admin(seed_data)) if t.sub_agent == 'attendance']

    def test_assignment_removed_while_the_card_is_open_is_refused_by_the_real_api(self, seed_data, reg):
        from academics.models import ClassTeacherAssignment
        ctx = _teacher(reg)
        card = _card(_mark(ctx, reg, absent_names=['Ahmad']))
        ClassTeacherAssignment.objects.all().delete()
        done = engine.approve(card.id, ctx.user, ctx.school_id)
        assert done.status == 'failed' and 'not assigned' in done.error
        assert _records() == {}


class TestCardLifecycle:
    def test_edit_toggles_a_status(self, seed_data, reg):
        ctx = _teacher(reg)
        card = _card(_mark(ctx, reg, absent_names=['Ahmad']))
        sid = reg['a_students'][1].id
        edited = engine.edit(card.id, ctx.user, ctx.school_id, {'statuses': {str(sid): 'LEAVE'}})
        assert edited.preview['totals'] == {'count': 2, 'present': 0, 'absent': 1, 'leave': 1}
        engine.approve(card.id, ctx.user, ctx.school_id)
        assert _records() == {'Ahmad Khan': 'ABSENT', 'Akram Ali': 'LEAVE'}

    @pytest.mark.parametrize('edits', [{'statuses': {'999999': 'ABSENT'}}, {'statuses': {'1': 'MAYBE'}}, {'date': '2099-01-01'}])
    def test_bad_edits_are_refused(self, seed_data, reg, edits):
        ctx = _teacher(reg)
        card = _card(_mark(ctx, reg))
        if 'statuses' in edits and '1' in edits['statuses']:
            edits = {'statuses': {str(reg['a_students'][0].id): 'MAYBE'}}
        with pytest.raises(engine.ActionError):
            engine.edit(card.id, ctx.user, ctx.school_id, edits)

    def test_someone_else_marking_meanwhile_forces_a_new_look(self, seed_data, reg):
        from attendance.models import AttendanceRecord
        ctx = _teacher(reg)
        card = _card(_mark(ctx, reg, absent_names=['Ahmad']))
        AttendanceRecord.objects.create(school=seed_data['school_a'], academic_year=seed_data['academic_year'], student=reg['a_students'][1],
                                        date=date(2025, 9, 15), status='LEAVE', source='MANUAL')
        with pytest.raises(engine.ActionError) as exc:
            engine.approve(card.id, ctx.user, ctx.school_id)
        assert exc.value.code == 'changed'
        replaced = {r['student']: r['was'] for r in exc.value.extra['action']['preview']['rows']}
        assert replaced['Akram Ali'] == 'LEAVE'
        assert _records() == {'Akram Ali': 'LEAVE'}                         # nothing of ours was written

    def test_http_flow(self, seed_data, reg, api):
        token = api.login(reg['teacher'].user.username)
        ctx = _teacher(reg)
        card = _card(_mark(ctx, reg, absent_names=['Ahmad']))
        r = api.post(f'/api/assistant/actions/{card.id}/approve/', {}, token, seed_data['SID_A'])
        assert r.status_code == 200 and r.json()['status'] == 'executed'
        assert _records()['Ahmad Khan'] == 'ABSENT'


class TestReads:
    def test_unmarked_lists_both_sections_then_only_the_unmarked_one(self, seed_data, reg):
        out = _run(_admin(seed_data), 'get_unmarked_attendance', date=DAY)['data']
        assert len(out['not_marked']) == 2 and not out['all_done']
        ctx = _teacher(reg)
        engine.approve(_card(_mark(ctx, reg)).id, ctx.user, ctx.school_id)
        out = _run(_admin(seed_data), 'get_unmarked_attendance', date=DAY)['data']
        assert [s['class'].endswith('B') for s in out['not_marked']] == [True]

    def test_partly_marked_is_reported(self, seed_data, reg):
        ctx = _teacher(reg)
        engine.approve(_card(_mark(ctx, reg, absent_names=['Ahmad'], rest='UNCHANGED')).id, ctx.user, ctx.school_id)
        out = _run(_admin(seed_data), 'get_unmarked_attendance', date=DAY)['data']
        assert [s['marked'] for s in out['partly_marked']] == [1]

    def test_teacher_sees_only_their_own_sections(self, seed_data, reg):
        out = _run(_teacher(reg), 'get_unmarked_attendance', date=DAY)['data']
        assert len(out['not_marked']) == 1 and out['not_marked'][0]['class'].endswith('A')

    def test_school_summary_counts_leave_as_marked(self, seed_data, reg):
        ctx = _teacher(reg)
        engine.approve(_card(_mark(ctx, reg, absent_names=['Ahmad'], leave_names=['Akram'])).id, ctx.user, ctx.school_id)
        out = _run(_admin(seed_data), 'get_attendance_summary_school', date=DAY)['data']
        assert (out['enrolled'], out['present'], out['absent'], out['leave'], out['not_marked']) == (4, 0, 1, 1, 2)

    def test_class_register_lists_absentees(self, seed_data, reg):
        ctx = _teacher(reg)
        engine.approve(_card(_mark(ctx, reg, absent_names=['Ahmad'])).id, ctx.user, ctx.school_id)
        out = _run(_admin(seed_data), 'get_class_attendance', class_name=reg['class_name'], section='A', date=DAY)['data']
        assert out['absent'] == ['Ahmad Khan'] and out['counts']['PRESENT'] == 1 and out['counts']['NOT MARKED'] == 0

    def test_class_register_for_a_teacher_outside_their_section_is_refused(self, seed_data, reg):
        assert 'not the class teacher' in _run(_teacher(reg), 'get_class_attendance', class_name=reg['class_name'], section='B', date=DAY)['error']

    def test_summary_is_not_available_to_teachers(self, seed_data, reg):
        assert 'permission' in _run(_teacher(reg), 'get_attendance_summary_school')['error']

    def test_manager_can_read_but_not_mark(self, seed_data, reg):
        mgr = _ctx(seed_data['users']['manager'])
        assert 'data' in _run(mgr, 'get_attendance_summary_school', date=DAY)
        assert 'permission' in _run(mgr, 'mark_attendance', class_name=reg['class_name'])['error']
