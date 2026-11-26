"""
When a teacher or admin creates an assignment without `teacher`, the server fills it.

The web's Daily Diary posted no teacher, so every diary was refused with "teacher: required".
A teacher writes as themselves; anyone else gets the subject's assigned teacher (the same
ClassSubject rule a manager's drafts use). An explicit teacher is still respected.
"""
import pytest

from academics.models import ClassSubject
from lms.models import Assignment


pytestmark = pytest.mark.django_db


def _diary(seed_data, seed_sections, **over):
    return {
        'class_obj': seed_sections['master'].id,
        'subject': seed_data['subjects'][0].id,
        'title': 'Maths Diary', 'description': 'Page 4', 'instructions': 'Page 4',
        'assignment_type': 'DIARY', 'requires_submission': False,
        'due_date': '2025-09-15', 'total_marks': 0, 'attachments_allowed': False,
        'status': 'DRAFT',
        **over,
    }


def _assign(seed_data, seed_sections, teacher):
    ClassSubject.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=seed_sections['master'], subject=seed_data['subjects'][0], teacher=teacher,
    )


def test_teacher_diary_without_teacher_is_written_as_themselves(seed_data, seed_sections, api):
    me = seed_data['staff'][0]
    token = api.login(me.user.username)

    response = api.post('/api/lms/assignments/', _diary(seed_data, seed_sections), token, seed_data['SID_A'])

    assert response.status_code == 201, response.content[:300]
    assert Assignment.objects.get(id=response.json()['id']).teacher_id == me.id


def test_admin_diary_without_teacher_gets_the_subject_teacher(seed_data, seed_sections, api):
    assigned = seed_data['staff'][1]
    _assign(seed_data, seed_sections, assigned)

    response = api.post('/api/lms/assignments/', _diary(seed_data, seed_sections),
                        seed_data['tokens']['admin'], seed_data['SID_A'])

    assert response.status_code == 201, response.content[:300]
    assert Assignment.objects.get(id=response.json()['id']).teacher_id == assigned.id


def test_admin_without_teacher_and_no_subject_teacher_is_refused(seed_data, seed_sections, api):
    response = api.post('/api/lms/assignments/', _diary(seed_data, seed_sections),
                        seed_data['tokens']['admin'], seed_data['SID_A'])

    assert response.status_code == 400
    assert 'No teacher is assigned' in response.content.decode()
    assert not Assignment.objects.exists()


def test_an_explicit_teacher_is_kept(seed_data, seed_sections, api):
    _assign(seed_data, seed_sections, seed_data['staff'][1])
    chosen = seed_data['staff'][2]

    response = api.post('/api/lms/assignments/', _diary(seed_data, seed_sections, teacher=chosen.id),
                        seed_data['tokens']['admin'], seed_data['SID_A'])

    assert response.status_code == 201, response.content[:300]
    assert Assignment.objects.get(id=response.json()['id']).teacher_id == chosen.id
