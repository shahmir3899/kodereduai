"""Portal calls the guide videos depend on: student assignment submit, parent leave cancel and
review scoping, and the exam-result grade / absent handling. The frontend once called two
URLs that did not exist (assignments/<id>/submit/ and leave-requests/<id>/cancel/), so these
go through the real routes."""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from examinations.models import Exam, ExamSubject, GradeScale, StudentMark
from lms.models import Assignment, AssignmentSubmission
from parents.models import ParentLeaveRequest
from students.test_profile_history import add_exam, pair, subjects  # noqa: F401
from students.test_timeline import ctx  # noqa: F401
from students.test_transfer_portals import (  # noqa: F401  (fixtures)
    PARENT, PORTAL, make_user, parent, publish_all, student_user,
)


def teacher_for(ctx):
    from hr.models import StaffMember
    return StaffMember.objects.create(
        school=ctx['school_b'], employee_id='PYTEST-T1', first_name='Pytest', last_name='Teacher',
        employment_status='ACTIVE')


def make_assignment(ctx, status='PUBLISHED', **extra):
    place = ctx['place']
    return Assignment.objects.create(
        school=ctx['school_b'], academic_year=place['year'], class_obj=place['master'],
        session_class=place['session_class'], subject=subjects(ctx)[1], teacher=teacher_for(ctx),
        title='PYTEST worksheet', description='Do it', assignment_type='HOMEWORK',
        due_date=timezone.now() + timedelta(days=3), total_marks=20, status=status, **extra,
    )


@pytest.mark.django_db
class TestStudentAssignments:
    def test_submit_goes_to_the_list_url_with_assignment_id(self, api, student_user):
        a = make_assignment(student_user)
        resp = api.post(f'{PORTAL}/assignments/', {'assignment_id': a.id, 'submission_text': 'done'},
                        student_user['token'], student_user['SID_B'])
        assert resp.status_code == 201
        # the old frontend URL never existed
        assert api.post(f'{PORTAL}/assignments/{a.id}/submit/', {}, student_user['token'],
                        student_user['SID_B']).status_code == 404

    def test_a_graded_zero_is_returned_as_zero_not_missing(self, api, student_user):
        a = make_assignment(student_user)
        AssignmentSubmission.objects.create(
            assignment=a, student=student_user['new'], school=student_user['school_b'],
            submission_text='x', status='GRADED', marks_obtained=Decimal('0'), feedback='Try again')
        rows = api.get(f'{PORTAL}/assignments/', student_user['token'], student_user['SID_B']).json()
        assert rows[0]['submission']['marks_obtained'] == 0.0

    def test_a_closed_assignment_rejects_submissions(self, api, student_user):
        a = make_assignment(student_user, status='CLOSED')
        resp = api.post(f'{PORTAL}/assignments/', {'assignment_id': a.id, 'submission_text': 'late'},
                        student_user['token'], student_user['SID_B'])
        assert resp.status_code == 404 and resp.json()['error']


@pytest.mark.django_db
class TestStudentResults:
    def test_exam_has_a_grade_and_an_absent_mark_stays_null(self, api, student_user):
        GradeScale.objects.create(school=student_user['school_b'], grade_label='A', min_percentage=80,
                                  max_percentage=100, gpa_points=4, order=1)
        a, b = subjects(student_user)
        exam = add_exam(student_user, student_user['new'], student_user['school_b'],
                        student_user['place']['year'], b, date(2026, 3, 20), 90)
        other = ExamSubject.objects.create(school=student_user['school_b'], exam=exam, subject=a,
                                           total_marks=100, passing_marks=40)
        StudentMark.objects.create(school=student_user['school_b'], exam_subject=other,
                                   student=student_user['new'], marks_obtained=None, is_absent=True)
        publish_all()
        result = api.get(f'{PORTAL}/results/', student_user['token'], student_user['SID_B']).json()[0]
        assert result['grade'] == 'A'                       # average of the marked subjects only
        assert any(s['is_absent'] and s['marks_obtained'] is None for s in result['subjects'])


@pytest.mark.django_db
class TestParentLeave:
    def apply(self, api, parent):
        body = {'student': parent['new'].id, 'start_date': '2026-03-10', 'end_date': '2026-03-11', 'reason': 'Wedding'}
        resp = api.post('/api/parents/leave-requests/', body, parent['token'], parent['SID_B'])
        assert resp.status_code == 201, resp.content
        return resp.json()['id']

    def test_cancel_is_a_delete_and_keeps_the_row_as_cancelled(self, api, parent):
        leave_id = self.apply(api, parent)
        assert api.delete(f'/api/parents/leave-requests/{leave_id}/', parent['token'], parent['SID_B']).status_code == 204
        assert ParentLeaveRequest.objects.get(id=leave_id).status == 'CANCELLED'
        # the old frontend URL never existed
        assert api.patch(f'/api/parents/leave-requests/{leave_id}/cancel/', {}, parent['token'],
                         parent['SID_B']).status_code == 404

    def test_the_parent_sees_the_reviewers_note(self, api, parent):
        leave_id = self.apply(api, parent)
        resp = api.patch(f'/api/parents/admin/leave-requests/{leave_id}/review/',
                         {'status': 'APPROVED', 'review_note': 'Take care'}, parent['tokens']['admin_b'], parent['SID_B'])
        assert resp.status_code == 200
        rows = api.get('/api/parents/leave-requests/', parent['token'], parent['SID_B']).json()
        rows = rows.get('results', rows)
        assert rows[0]['review_note'] == 'Take care'

    def test_an_admin_of_another_school_cannot_review(self, api, parent):
        leave_id = self.apply(api, parent)
        resp = api.patch(f'/api/parents/admin/leave-requests/{leave_id}/review/',
                         {'status': 'APPROVED'}, parent['tokens']['admin'], parent['SID_A'])
        assert resp.status_code == 404
        assert ParentLeaveRequest.objects.get(id=leave_id).status == 'PENDING'
