"""
A manager prepares assignments as DRAFTS only; a teacher or admin publishes.

The teacher on the row is never the manager's choice: it is the teacher assigned to the
subject for the class or section (ClassSubject), and the request is refused when that is not
exactly one person. Builds on seed_data/seed_sections (Class_1A split into sections A and B).
"""
import pytest

from academics.models import ClassSubject
from lms.models import Assignment


pytestmark = pytest.mark.django_db


def _assign(seed_data, seed_sections, teacher, section=None):
    return ClassSubject.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        session_class=section, class_obj=seed_sections['master'],
        subject=seed_data['subjects'][0], teacher=teacher,
    )


def _body(seed_data, seed_sections, section=None, **over):
    body = {
        'class_obj': seed_sections['master'].id,
        'subject': seed_data['subjects'][0].id,
        'title': 'Fractions', 'description': 'Do page 4',
        'assignment_type': 'HOMEWORK', 'requires_submission': True,
        'due_date': '2025-09-15T10:00:00Z',
        **over,
    }
    if section is not None:
        body['session_class'] = section.id
    return body


def _post(api, seed_data, body, who='manager'):
    return api.post('/api/lms/assignments/', body, seed_data['tokens'][who], seed_data['SID_A'])


def test_manager_draft_gets_the_assigned_teacher(seed_data, seed_sections, api):
    teacher = seed_data['staff'][1]
    _assign(seed_data, seed_sections, teacher)

    response = _post(api, seed_data, _body(seed_data, seed_sections))

    assert response.status_code == 201, response.content[:300]
    row = Assignment.objects.get(id=response.json()['id'])
    assert row.status == Assignment.Status.DRAFT
    assert row.teacher_id == teacher.id


def test_a_teacher_sent_by_the_manager_is_ignored(seed_data, seed_sections, api):
    assigned, other = seed_data['staff'][1], seed_data['staff'][0]
    _assign(seed_data, seed_sections, assigned)

    response = _post(api, seed_data, _body(seed_data, seed_sections, teacher=other.id))

    assert response.status_code == 201, response.content[:300]
    assert Assignment.objects.get(id=response.json()['id']).teacher_id == assigned.id


def test_manager_cannot_create_a_published_assignment(seed_data, seed_sections, api):
    _assign(seed_data, seed_sections, seed_data['staff'][1])

    response = _post(api, seed_data, _body(seed_data, seed_sections, status='PUBLISHED'))

    assert response.status_code == 403
    assert not Assignment.objects.exists()


def test_refused_when_no_teacher_is_assigned(seed_data, seed_sections, api):
    response = _post(api, seed_data, _body(seed_data, seed_sections))

    assert response.status_code == 400
    assert 'No teacher is assigned' in response.content.decode()
    assert not Assignment.objects.exists()


def test_whole_class_with_two_section_teachers_is_refused_but_one_section_works(seed_data, seed_sections, api):
    a_teacher, b_teacher = seed_data['staff'][0], seed_data['staff'][1]
    _assign(seed_data, seed_sections, a_teacher, seed_sections['section_a'])
    _assign(seed_data, seed_sections, b_teacher, seed_sections['section_b'])

    whole = _post(api, seed_data, _body(seed_data, seed_sections))
    one = _post(api, seed_data, _body(seed_data, seed_sections, section=seed_sections['section_b']))

    assert whole.status_code == 400
    assert 'More than one teacher' in whole.content.decode()
    assert one.status_code == 201, one.content[:300]
    assert Assignment.objects.get(id=one.json()['id']).teacher_id == b_teacher.id


def test_a_section_without_its_own_subject_row_uses_the_class_wide_teacher(seed_data, seed_sections, api):
    teacher = seed_data['staff'][1]
    _assign(seed_data, seed_sections, teacher)  # class-wide (no section)

    response = _post(api, seed_data, _body(seed_data, seed_sections, section=seed_sections['section_a']))

    assert response.status_code == 201, response.content[:300]
    assert Assignment.objects.get(id=response.json()['id']).teacher_id == teacher.id


def test_manager_edits_and_deletes_a_draft_but_cannot_publish_or_close(seed_data, seed_sections, api):
    _assign(seed_data, seed_sections, seed_data['staff'][1])
    created = _post(api, seed_data, _body(seed_data, seed_sections)).json()
    token, sid = seed_data['tokens']['manager'], seed_data['SID_A']
    url = f"/api/lms/assignments/{created['id']}/"

    edited = api.patch(url, {'title': 'Fractions 2'}, token, sid)
    assert edited.status_code == 200, edited.content[:300]
    assert Assignment.objects.get(id=created['id']).title == 'Fractions 2'

    assert api.post(f'{url}publish/', {}, token, sid).status_code == 403
    assert api.post(f'{url}close/', {}, token, sid).status_code == 403
    assert api.patch(url, {'status': 'PUBLISHED'}, token, sid).status_code == 403
    assert Assignment.objects.get(id=created['id']).status == Assignment.Status.DRAFT

    assert api.delete(url, token, sid).status_code == 204
    assert not Assignment.objects.filter(id=created['id']).exists()


def test_manager_cannot_change_or_delete_a_published_assignment(seed_data, seed_sections, api):
    teacher = seed_data['staff'][1]
    _assign(seed_data, seed_sections, teacher)
    row = Assignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        class_obj=seed_sections['master'], subject=seed_data['subjects'][0], teacher=teacher,
        title='Live', description='x', due_date='2025-09-15T10:00:00Z', status=Assignment.Status.PUBLISHED,
    )
    token, sid = seed_data['tokens']['manager'], seed_data['SID_A']

    assert api.patch(f'/api/lms/assignments/{row.id}/', {'title': 'Changed'}, token, sid).status_code == 403
    assert api.delete(f'/api/lms/assignments/{row.id}/', token, sid).status_code == 403
    row.refresh_from_db()
    assert row.title == 'Live'


def test_the_subject_teacher_sees_the_managers_draft_and_publishes_it(seed_data, seed_sections, api):
    teacher = seed_data['staff'][1]
    _assign(seed_data, seed_sections, teacher)
    created = _post(api, seed_data, _body(seed_data, seed_sections)).json()
    token = api.login(teacher.user.username)
    sid = seed_data['SID_A']

    listing = api.get('/api/lms/assignments/?page_size=50&status=DRAFT', token, sid)
    ids = {r['id'] for r in listing.json().get('results', listing.json())}
    published = api.post(f"/api/lms/assignments/{created['id']}/publish/", {}, token, sid)

    assert created['id'] in ids
    assert published.status_code == 200, published.content[:300]
    assert Assignment.objects.get(id=created['id']).status == Assignment.Status.PUBLISHED


def test_admin_is_unchanged_and_still_picks_the_teacher_and_publishes(seed_data, seed_sections, api):
    chosen = seed_data['staff'][0]

    response = _post(api, seed_data, _body(seed_data, seed_sections, teacher=chosen.id, status='PUBLISHED'), who='admin')

    assert response.status_code == 201, response.content[:300]
    row = Assignment.objects.get(id=response.json()['id'])
    assert row.teacher_id == chosen.id
    assert row.status == Assignment.Status.PUBLISHED
