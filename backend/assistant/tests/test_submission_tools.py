"""Assignment submissions through Aura (backlog item H): who handed in, who did not, grading, returning. No model is reached."""
from datetime import timedelta

import pytest
from django.utils import timezone

from assistant import engine, registry
from assistant.models import AgentAction, AgentConversation
from assistant.skills import load_all

pytestmark = pytest.mark.django_db
NO_PERMISSION = {'error': 'You do not have permission to use this tool.'}


@pytest.fixture(autouse=True)
def _tools():
    load_all()


@pytest.fixture
def work(seed_data, seed_sections):
    """Section A has two students (a_students). Ali handed in, Sara did not. One assignment out of 10 marks."""
    from academics.models import Subject
    from lms.models import Assignment, AssignmentSubmission

    school, org, ay = seed_data['school_a'], seed_data['org'], seed_data['academic_year']
    mods = {'lms': True, 'academics': True}
    school.enabled_modules = {**(school.enabled_modules or {}), **mods}
    school.save(update_fields=['enabled_modules'])
    org.allowed_modules = {**(org.allowed_modules or {}), **mods}
    org.save(update_fields=['allowed_modules'])
    english = Subject.objects.create(school=school, name='English', code='ENG')
    section_a, master = seed_sections['section_a'], seed_sections['master']
    ali_staff = seed_data['staff'][0]
    a = Assignment.objects.create(school=school, academic_year=ay, class_obj=master, session_class=section_a, subject=english, teacher=ali_staff,
                                  title='Essay on Summer', description='Write an essay', assignment_type='HOMEWORK', total_marks=10,
                                  due_date=timezone.now() + timedelta(days=3), status='PUBLISHED')
    ali, sara = seed_sections['a_students']
    sub = AssignmentSubmission.objects.create(assignment=a, student=ali, school=school, submission_text='my essay', status='SUBMITTED')
    return {'assignment': a, 'ali': ali, 'sara': sara, 'sub': sub, 'english': english}


def _run(seed_data, tool, role='admin', **args):
    user = seed_data['users'][role]
    ctx = registry.ToolContext(user=user, school_id=user.school_id, role=user.role)
    ctx.conversation = AgentConversation.objects.create(school_id=ctx.school_id, user=user)
    return registry.execute(ctx, tool, args)


def _approve(seed_data, out):
    user = seed_data['users']['admin']
    return engine.approve(out['proposal']['action_id'], user, user.school_id)


class TestReads:
    def test_list_submissions_counts_by_status(self, seed_data, work):
        out = _run(seed_data, 'list_submissions', title='Essay')['data']
        assert out['count'] == 1 and out['by_status'] == {'SUBMITTED': 1} and out['total_marks'] == 10.0
        assert out['submissions'][0]['student'].endswith('Ali Hassan')

    def test_missing_submissions_is_the_roster_minus_the_submitted(self, seed_data, work):
        out = _run(seed_data, 'get_missing_submissions', assignment_id=work['assignment'].id)['data']
        assert out['class_size'] == 2 and out['submitted'] == 1 and out['not_submitted'] == 1
        assert out['students'][0].endswith('Sara Khan')

    def test_ambiguous_or_unknown_assignment_asks(self, seed_data, work):
        from lms.models import Assignment
        Assignment.objects.create(school=seed_data['school_a'], academic_year=seed_data['academic_year'], class_obj=work['assignment'].class_obj,
                                  session_class=work['assignment'].session_class, subject=work['english'], teacher=seed_data['staff'][0],
                                  title='Essay on Winter', description='x', assignment_type='HOMEWORK')
        assert 'Several assignments match' in _run(seed_data, 'list_submissions', title='Essay')['error']
        assert 'No assignment matches' in _run(seed_data, 'list_submissions', title='Quiz')['error']
        assert 'Which assignment' in _run(seed_data, 'list_submissions')['error']

    def test_a_teacher_only_reaches_their_own_assignments(self, seed_data, work):
        # the seed teacher user has no staff profile, so Aura cannot place them: nothing of someone else's is shown
        out = _run(seed_data, 'list_submissions', 'teacher', title='Essay')
        assert 'error' in out and 'data' not in out

    def test_roles(self, seed_data, work):
        for role in ('staff',):
            assert _run(seed_data, 'list_submissions', role, title='Essay') == NO_PERMISSION


class TestGradeAndReturn:
    def test_grade_card_then_marks_saved_on_approval(self, seed_data, work):
        from lms.models import AssignmentSubmission
        out = _run(seed_data, 'grade_submissions', assignment_id=work['assignment'].id, grades=[{'student_name': 'Ali', 'marks': 8, 'feedback': 'Good'}])
        assert out['status'] == 'awaiting_user_approval'
        assert AssignmentSubmission.objects.get().status == 'SUBMITTED'
        card = AgentAction.objects.get(pk=out['proposal']['action_id'])
        assert card.preview['rows'][0]['marks'] == 8 and card.preview['totals']['out_of'] == 10.0
        done = _approve(seed_data, out)
        assert done.status == 'executed' and done.result['updated'] == 1
        sub = AssignmentSubmission.objects.get()
        assert (sub.status, float(sub.marks_obtained), sub.feedback) == ('GRADED', 8.0, 'Good')

    def test_marks_above_the_total_or_negative_are_refused_before_the_card(self, seed_data, work):
        too_high = _run(seed_data, 'grade_submissions', assignment_id=work['assignment'].id, grades=[{'student_name': 'Ali', 'marks': 11}])
        assert 'above the total of 10' in too_high['error']
        assert 'negative' in _run(seed_data, 'grade_submissions', assignment_id=work['assignment'].id, grades=[{'student_name': 'Ali', 'marks': -1}])['error']

    def test_a_student_who_did_not_submit_gets_a_clear_answer(self, seed_data, work):
        out = _run(seed_data, 'grade_submissions', assignment_id=work['assignment'].id, grades=[{'student_name': 'Sara', 'marks': 5}])
        assert 'has not submitted' in out['error']

    def test_edit_a_mark_and_regrade_warning(self, seed_data, work):
        out = _run(seed_data, 'grade_submissions', assignment_id=work['assignment'].id, grades=[{'student_name': 'Ali', 'marks': 8}])
        user = seed_data['users']['admin']
        edited = engine.edit(out['proposal']['action_id'], user, user.school_id, {'amounts': {str(work['sub'].id): '9'}})
        assert edited.preview['rows'][0]['marks'] == 9
        _approve(seed_data, out)
        again = _run(seed_data, 'grade_submissions', assignment_id=work['assignment'].id, grades=[{'student_name': 'Ali', 'marks': 7}])
        card = AgentAction.objects.get(pk=again['proposal']['action_id'])
        assert 'already have marks' in card.preview['warnings'][0] and card.preview['rows'][0]['was'] == 9.0

    def test_return_only_graded_work(self, seed_data, work):
        from lms.models import AssignmentSubmission
        assert 'No graded work' in _run(seed_data, 'return_submissions', assignment_id=work['assignment'].id)['error']
        _approve(seed_data, _run(seed_data, 'grade_submissions', assignment_id=work['assignment'].id, grades=[{'student_name': 'Ali', 'marks': 8}]))
        out = _run(seed_data, 'return_submissions', assignment_id=work['assignment'].id)
        assert out['status'] == 'awaiting_user_approval' and AssignmentSubmission.objects.get().status == 'GRADED'
        _approve(seed_data, out)
        assert AssignmentSubmission.objects.get().status == 'RETURNED'

    def test_only_admins_and_teachers_may_prepare_grading(self, seed_data, work):
        for role in ('manager', 'finance_manager'):
            assert _run(seed_data, 'grade_submissions', role, assignment_id=work['assignment'].id, grades=[{'student_name': 'Ali', 'marks': 1}]) == NO_PERMISSION, role
