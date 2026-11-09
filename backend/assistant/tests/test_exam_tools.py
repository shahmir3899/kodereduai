"""Exams through the assistant: results, marks entry, creating / moving / deleting an exam.
The model is mocked; reads and writes go through the real examinations API."""
from decimal import Decimal
from unittest.mock import patch

import pytest

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _all_agents_offered():
    with patch('assistant.router.pick_agents', lambda by_agent, message, recent=(): list(by_agent)):
        yield


@pytest.fixture
def exams(seed_data, seed_sections):
    from academic_sessions.models import SessionClass
    from academics.models import ClassSubject, Subject
    from examinations.models import Exam, ExamSubject, ExamType

    school, year, master = seed_data['school_a'], seed_data['academic_year'], seed_data['classes'][0]
    school.enabled_modules = {**(school.enabled_modules or {}), 'examinations': True, 'academics': True}
    school.save(update_fields=['enabled_modules'])
    org = school.organization
    org.allowed_modules = {**(org.allowed_modules or {}), 'examinations': True, 'academics': True}
    org.save(update_fields=['allowed_modules'])

    sec_a = seed_sections['section_a']
    maths = Subject.objects.create(school=school, name='Maths', code='MTH')
    urdu = Subject.objects.create(school=school, name='Urdu', code='URD')
    teacher_staff = seed_data['staff'][0]
    for sub in (maths, urdu):
        ClassSubject.objects.create(school=school, academic_year=year, session_class=sec_a, class_obj=master, subject=sub,
                                    teacher=teacher_staff if sub is maths else seed_data['staff'][1])
    mid = ExamType.objects.create(school=school, name='Mid Term')
    final = ExamType.objects.create(school=school, name='Final Term')
    exam = Exam.objects.create(school=school, academic_year=year, exam_type=mid, class_obj=master, session_class=sec_a,
                               name='Mid Term - Class 1A', status='SCHEDULED')
    es = {s.name: ExamSubject.objects.create(school=school, exam=exam, subject=s, total_marks=50, passing_marks=20) for s in (maths, urdu)}
    return {'exam': exam, 'es': es, 'mid': mid, 'final': final, 'sec_a': sec_a, 'students': seed_sections['a_students'],
            'master': master, 'maths': maths, 'urdu': urdu}


def _ctx(seed, uname='admin'):
    user = seed['users'][uname]
    return registry.ToolContext(user=user, school_id=seed['SID_A'], role=user.role)


def _run(seed, tool, uname='admin', **args):
    ctx = _ctx(seed, uname)
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=ctx.user)
    return registry.execute(ctx, tool, args)


def _card(out):
    assert 'proposal' in out, out
    return AgentAction.objects.get(pk=out['proposal']['action_id'])


def _marks(exams, subject='Maths'):
    from examinations.models import StudentMark
    return {m.student_id: m for m in StudentMark.objects.filter(exam_subject=exams['es'][subject])}


class TestReads:
    def test_list_exams_shows_the_exam(self, seed_data, exams):
        out = _run(seed_data, 'list_exams')
        assert exams['exam'].id in [e['exam_id'] for e in out['data']['exams']]

    def test_list_exams_filters_by_name(self, seed_data, exams):
        assert _run(seed_data, 'list_exams', exam_name='final')['data']['count'] == 0

    def test_results_summary_counts_pass_and_fail(self, seed_data, exams):
        from examinations.models import StudentMark
        a, b = exams['students']
        exams['exam'].fail_threshold_subjects = 1      # the school rule: this many failed subjects fail the student
        exams['exam'].save(update_fields=['fail_threshold_subjects'])
        for es in exams['es'].values():
            StudentMark.objects.create(school=exams['exam'].school, exam_subject=es, student=a, marks_obtained=45)
            StudentMark.objects.create(school=exams['exam'].school, exam_subject=es, student=b, marks_obtained=5)
        out = _run(seed_data, 'get_exam_results', exam_id=exams['exam'].id)
        assert 'data' in out, out
        d = out['data']
        assert d['complete'] == 2 and d['passed'] == 1 and d['failed'] == 1 and d['pass_percent'] == 50.0
        assert d['top'][0]['name'] == a.name
        assert {s['subject'] for s in d['subjects']} == {'Maths', 'Urdu'}

    def test_marks_entry_status_lists_who_is_missing(self, seed_data, exams):
        from examinations.models import StudentMark
        a, b = exams['students']
        StudentMark.objects.create(school=exams['exam'].school, exam_subject=exams['es']['Maths'], student=a, marks_obtained=30)
        out = _run(seed_data, 'get_marks_entry_status', exam_id=exams['exam'].id)['data']
        maths = next(s for s in out['subjects'] if s['subject'] == 'Maths')
        assert maths['missing'] == 1 and maths['missing_names'] == [b.name]
        assert out['all_marks_entered'] is False

    def test_student_marks(self, seed_data, exams):
        from examinations.models import StudentMark
        a = exams['students'][0]
        StudentMark.objects.create(school=exams['exam'].school, exam_subject=exams['es']['Maths'], student=a, marks_obtained=33)
        out = _run(seed_data, 'get_student_marks', student_id=a.id)['data']
        assert out['exams'][0]['exam'] == 'Mid Term - Class 1A'
        assert out['exams'][0]['subjects'][0]['marks'] == 33.0

    def test_ambiguous_exam_asks_instead_of_guessing(self, seed_data, exams):
        from examinations.models import Exam
        Exam.objects.create(school=exams['exam'].school, academic_year=exams['exam'].academic_year, exam_type=exams['mid'],
                            class_obj=exams['master'], session_class=exams['sec_a'], name='Mid Term Retake', status='SCHEDULED')
        out = _run(seed_data, 'get_exam_results', exam_name='mid term')
        assert 'error' in out and 'Several exams match' in out['error']

    def test_teacher_without_assignment_cannot_read_results(self, seed_data, exams):
        out = _run(seed_data, 'get_exam_results', 'teacher', exam_id=exams['exam'].id)
        assert 'error' in out

    def test_at_risk_is_admin_only(self, seed_data, exams):
        assert 'error' in _run(seed_data, 'get_at_risk_students', 'teacher')

    def test_grade_scale(self, seed_data, exams):
        from examinations.models import GradeScale
        GradeScale.objects.create(school=exams['exam'].school, grade_label='A', min_percentage=80, max_percentage=100)
        assert _run(seed_data, 'get_grade_scale')['data']['grades'][0]['grade'] == 'A'


class TestEnterMarks:
    ENTRIES = lambda self, exams: [{'student_name': exams['students'][0].name, 'marks': 40}, {'student_id': exams['students'][1].id, 'absent': True}]

    def test_proposing_saves_nothing_and_shows_the_rows(self, seed_data, exams):
        card = _card(_run(seed_data, 'enter_marks', exam_id=exams['exam'].id, subject_name='maths', entries=self.ENTRIES(exams)))
        assert _marks(exams) == {}
        assert card.preview['kind'] == 'marks_entry'
        assert [r['marks'] for r in card.preview['rows']] == [40.0, None]
        assert card.preview['totals']['average'] == 40.0

    def test_approve_saves_marks_and_absence(self, seed_data, exams):
        card = _card(_run(seed_data, 'enter_marks', exam_id=exams['exam'].id, subject_name='maths', entries=self.ENTRIES(exams)))
        engine.approve(card.id, seed_data['users']['admin'], seed_data['SID_A'])
        saved = _marks(exams)
        assert saved[exams['students'][0].id].marks_obtained == Decimal('40.00')
        assert saved[exams['students'][1].id].is_absent is True

    def test_marks_above_the_paper_total_are_refused(self, seed_data, exams):
        out = _run(seed_data, 'enter_marks', exam_id=exams['exam'].id, subject_name='maths',
                   entries=[{'student_id': exams['students'][0].id, 'marks': 99}])
        assert 'error' in out and 'between 0 and 50' in out['error']

    def test_unknown_subject_lists_the_real_ones(self, seed_data, exams):
        out = _run(seed_data, 'enter_marks', exam_id=exams['exam'].id, subject_name='physics',
                   entries=[{'student_id': exams['students'][0].id, 'marks': 5}])
        assert 'error' in out and 'Maths' in out['error']

    def test_missing_subject_asks_which(self, seed_data, exams):
        out = _run(seed_data, 'enter_marks', exam_id=exams['exam'].id, entries=[{'student_id': exams['students'][0].id, 'marks': 5}])
        assert 'error' in out and 'Which subject' in out['error']

    def test_edit_changes_one_mark_before_approval(self, seed_data, exams):
        a = exams['students'][0]
        card = _card(_run(seed_data, 'enter_marks', exam_id=exams['exam'].id, subject_name='maths', entries=[{'student_id': a.id, 'marks': 10}]))
        card = engine.edit(card.id, seed_data['users']['admin'], seed_data['SID_A'], {'amounts': {str(a.id): '44'}})
        engine.approve(card.id, seed_data['users']['admin'], seed_data['SID_A'])
        assert _marks(exams)[a.id].marks_obtained == Decimal('44.00')

    def test_replacing_a_mark_warns(self, seed_data, exams):
        from examinations.models import StudentMark
        a = exams['students'][0]
        StudentMark.objects.create(school=exams['exam'].school, exam_subject=exams['es']['Maths'], student=a, marks_obtained=12)
        card = _card(_run(seed_data, 'enter_marks', exam_id=exams['exam'].id, subject_name='maths', entries=[{'student_id': a.id, 'marks': 30}]))
        assert any('replaced' in w for w in card.preview['warnings'])
        assert card.preview['rows'][0]['was'] == '12'

    def test_below_passing_is_flagged(self, seed_data, exams):
        card = _card(_run(seed_data, 'enter_marks', exam_id=exams['exam'].id, subject_name='maths',
                          entries=[{'student_id': exams['students'][0].id, 'marks': 5}]))
        assert any('below the passing marks' in w for w in card.preview['warnings'])

    def test_a_teacher_with_no_subject_here_cannot_propose(self, seed_data, exams):
        out = _run(seed_data, 'enter_marks', 'teacher', exam_id=exams['exam'].id, subject_name='maths',
                   entries=[{'student_id': exams['students'][0].id, 'marks': 5}])
        assert 'error' in out

    def test_parents_and_students_have_no_write_tools(self):
        for name in ('enter_marks', 'create_exam', 'reschedule_exam', 'delete_exam'):
            assert not set(registry.get_tool(name).roles) & set(registry.NO_WRITE_ROLES)


class TestExamLifecycle:
    def test_create_exam_previews_then_creates_with_subjects(self, seed_data, exams):
        from examinations.models import Exam
        card = _card(_run(seed_data, 'create_exam', class_name=exams['master'].name, exam_type='final', start_date='2026-12-01', end_date='2026-12-10'))
        assert not Exam.objects.filter(exam_type=exams['final']).exists()
        engine.approve(card.id, seed_data['users']['admin'], seed_data['SID_A'])
        made = Exam.objects.get(exam_type=exams['final'])
        assert made.start_date.isoformat() == '2026-12-01' and made.class_obj_id == exams['master'].id

    def test_create_exam_asks_for_the_type(self, seed_data, exams):
        out = _run(seed_data, 'create_exam', class_name=exams['master'].name)
        assert 'error' in out and 'Mid Term' in out['error']

    def test_create_exam_rejects_backwards_dates(self, seed_data, exams):
        out = _run(seed_data, 'create_exam', class_name=exams['master'].name, exam_type='final', start_date='2026-12-10', end_date='2026-12-01')
        assert 'error' in out

    def test_reschedule_moves_exam_and_paper_dates(self, seed_data, exams):
        card = _card(_run(seed_data, 'reschedule_exam', exam_id=exams['exam'].id, start_date='2026-12-05', end_date='2026-12-09',
                          subject_dates=[{'subject_name': 'maths', 'date': '2026-12-06'}]))
        assert len(card.preview['rows']) == 3
        engine.approve(card.id, seed_data['users']['admin'], seed_data['SID_A'])
        exams['exam'].refresh_from_db()
        exams['es']['Maths'].refresh_from_db()
        assert exams['exam'].start_date.isoformat() == '2026-12-05'
        assert exams['es']['Maths'].exam_date.isoformat() == '2026-12-06'

    def test_reschedule_refuses_a_published_exam(self, seed_data, exams):
        exams['exam'].status = 'PUBLISHED'
        exams['exam'].save(update_fields=['status'])
        assert 'error' in _run(seed_data, 'reschedule_exam', exam_id=exams['exam'].id, start_date='2026-12-05')

    def test_delete_works_only_for_an_unstarted_exam_without_marks(self, seed_data, exams):
        from examinations.models import Exam
        card = _card(_run(seed_data, 'delete_exam', exam_id=exams['exam'].id))
        engine.approve(card.id, seed_data['users']['admin'], seed_data['SID_A'])
        assert not Exam.objects.filter(pk=exams['exam'].id).exists()

    def test_delete_refuses_when_marks_exist(self, seed_data, exams):
        from examinations.models import StudentMark
        StudentMark.objects.create(school=exams['exam'].school, exam_subject=exams['es']['Maths'], student=exams['students'][0], marks_obtained=9)
        out = _run(seed_data, 'delete_exam', exam_id=exams['exam'].id)
        assert 'error' in out and 'already has' in out['error']

    def test_teachers_cannot_create_or_delete_exams(self, seed_data, exams):
        assert 'error' in _run(seed_data, 'delete_exam', 'teacher', exam_id=exams['exam'].id)
        assert 'error' in _run(seed_data, 'create_exam', 'teacher', class_name=exams['master'].name, exam_type='final')


class TestSubjectTeacherScope:
    """A subject teacher enters marks for their own paper only (the same scope as the marks screen)."""

    def _run_as_teacher(self, seed, exams, tool, **args):
        user = seed['staff'][0].user
        ctx = registry.ToolContext(user=user, school_id=seed['SID_A'], role=user.role)
        ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=user)
        return registry.execute(ctx, tool, args)

    def test_own_subject_works_and_is_saved(self, seed_data, exams):
        a = exams['students'][0]
        out = self._run_as_teacher(seed_data, exams, 'enter_marks', exam_id=exams['exam'].id, subject_name='maths',
                                   entries=[{'student_id': a.id, 'marks': 41}])
        card = _card(out)
        engine.approve(card.id, seed_data['staff'][0].user, seed_data['SID_A'])
        assert _marks(exams)[a.id].marks_obtained == Decimal('41.00')

    def test_someone_elses_subject_is_not_offered(self, seed_data, exams):
        out = self._run_as_teacher(seed_data, exams, 'enter_marks', exam_id=exams['exam'].id, subject_name='urdu',
                                   entries=[{'student_id': exams['students'][0].id, 'marks': 41}])
        assert 'error' in out and 'Maths' in out['error']
