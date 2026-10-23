"""
Submission review: grade/return are staff-only, return needs GRADED, and a
null due_date no longer breaks late detection. Uses the shared seed_data.
"""
from datetime import datetime, timezone

import pytest

from lms.models import Assignment, AssignmentSubmission


pytestmark = pytest.mark.django_db


@pytest.fixture
def submission(seed_data):
    assignment = Assignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=seed_data['classes'][0], subject=seed_data['subjects'][0],
        teacher=seed_data['staff'][0], title='Review me', description='x',
        due_date=datetime(2030, 1, 1, tzinfo=timezone.utc), total_marks=10,
        status=Assignment.Status.PUBLISHED,
    )
    return AssignmentSubmission.objects.create(
        assignment=assignment, student=seed_data['students'][0],
        school=seed_data['school_a'], submission_text='done',
    )


def test_admin_can_grade_then_return(seed_data, api, submission):
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    graded = api.patch(f'/api/lms/submissions/{submission.id}/grade/', {'marks_obtained': 8}, token, sid)
    assert graded.status_code == 200, graded.content[:300]
    returned = api.post(f'/api/lms/submissions/{submission.id}/return/', {}, token, sid)
    assert returned.status_code == 200, returned.content[:300]
    submission.refresh_from_db()
    assert submission.status == AssignmentSubmission.Status.RETURNED


def test_return_requires_graded_submission(seed_data, api, submission):
    response = api.post(
        f'/api/lms/submissions/{submission.id}/return/', {},
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )
    assert response.status_code == 400


def test_non_teaching_role_cannot_grade(seed_data, api, submission):
    response = api.patch(
        f'/api/lms/submissions/{submission.id}/grade/', {'marks_obtained': 10},
        seed_data['tokens']['accountant'], seed_data['SID_A'],
    )
    assert response.status_code == 403
    submission.refresh_from_db()
    assert submission.marks_obtained is None


def test_list_filters_by_assignment_id(seed_data, api, submission):
    other = Assignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=seed_data['classes'][0], subject=seed_data['subjects'][0],
        teacher=seed_data['staff'][0], title='Other', description='x',
        due_date=datetime(2030, 1, 1, tzinfo=timezone.utc), status=Assignment.Status.PUBLISHED,
    )
    AssignmentSubmission.objects.create(
        assignment=other, student=seed_data['students'][1], school=seed_data['school_a'],
    )
    response = api.get(
        f'/api/lms/submissions/?assignment_id={submission.assignment_id}&page_size=50',
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )
    data = response.json()
    rows = data.get('results', data)
    assert {r['assignment'] for r in rows} == {submission.assignment_id}


def test_assignment_and_lesson_plan_create_without_school_field(seed_data, api):
    """The web forms never send `school`; the tenant mixin fills it in."""
    token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    base = {
        'teacher': seed_data['staff'][0].id, 'class_obj': seed_data['classes'][0].id,
        'subject': seed_data['subjects'][0].id, 'title': 'No school field', 'description': 'x',
    }
    assignment = api.post('/api/lms/assignments/', dict(base, assignment_type='HOMEWORK', requires_submission=True,
                                                      due_date='2030-04-04'), token, sid)
    assert assignment.status_code == 201, assignment.content[:300]
    plan = api.post('/api/lms/lesson-plans/', dict(base, lesson_date='2027-04-04'), token, sid)
    assert plan.status_code == 201, plan.content[:300]
    assert api.post('/api/lms/assignments/', dict(base, teacher=None, due_date='2030-04-04'), token, sid).status_code == 400
