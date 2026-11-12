"""Admin parent<->student linking: sibling batch link, suggestions, school scoping."""
import pytest

from parents.models import ParentChild, ParentInvite, ParentProfile
from students.models import Student
from users.models import User

pytestmark = pytest.mark.django_db


def _make_parent(seed, suffix='p1', school=None):
    school = school or seed['school_a']
    user = User.objects.create_user(
        username=f"{seed['prefix']}parent_{suffix}", email=f"{seed['prefix']}parent_{suffix}@test.com",
        password=seed['password'],
        role='PARENT', school=school, organization=seed['org'],
    )
    return ParentProfile.objects.create(user=user, phone='03001234567')


def _link(profile, student, school, **kw):
    return ParentChild.objects.create(
        parent=profile, student=student, school=school, relation=kw.get('relation', 'FATHER'),
        is_primary=kw.get('is_primary', False),
    )


def test_batch_link_siblings_skips_already_linked(api, seed_data):
    s = seed_data
    parent = _make_parent(s)
    a, b, c = s['students'][:3]
    _link(parent, a, s['school_a'])

    resp = api.post(
        '/api/parents/admin/link-children/',
        {'parent_profile_id': parent.id, 'student_ids': [a.id, b.id, c.id], 'relation': 'FATHER'},
        s['tokens']['admin'], s['SID_A'],
    )
    assert resp.status_code == 201
    body = resp.json()
    assert {x['student'] for x in body['linked']} == {b.id, c.id}
    assert body['skipped'] == [{'student_id': a.id, 'reason': 'already_linked'}]
    assert ParentChild.objects.filter(parent=parent).count() == 3


def test_principal_can_link(api, seed_data):
    s = seed_data
    parent = _make_parent(s)
    _link(parent, s['students'][0], s['school_a'])
    resp = api.post(
        '/api/parents/admin/link-children/',
        {'parent_profile_id': parent.id, 'student_ids': [s['students'][1].id], 'relation': 'MOTHER'},
        s['tokens']['principal'], s['SID_A'],
    )
    assert resp.status_code == 201


def test_teacher_cannot_link(api, seed_data):
    s = seed_data
    parent = _make_parent(s)
    _link(parent, s['students'][0], s['school_a'])
    resp = api.post(
        '/api/parents/admin/link-children/',
        {'parent_profile_id': parent.id, 'student_ids': [s['students'][1].id], 'relation': 'MOTHER'},
        s['tokens']['teacher'], s['SID_A'],
    )
    assert resp.status_code == 403


def test_other_school_student_is_not_linkable(api, seed_data):
    s = seed_data
    from students.models import Class
    cls_b = Class.objects.create(school=s['school_b'], name='B1', section='A', grade_level=1)
    foreign = Student.objects.create(
        school=s['school_b'], class_obj=cls_b, roll_number='1', name='Foreign', is_active=True, status='ACTIVE',
    )
    parent = _make_parent(s)
    _link(parent, s['students'][0], s['school_a'])
    resp = api.post(
        '/api/parents/admin/link-children/',
        {'parent_profile_id': parent.id, 'student_ids': [foreign.id], 'relation': 'FATHER'},
        s['tokens']['admin'], s['SID_A'],
    )
    assert resp.json()['skipped'] == [{'student_id': foreign.id, 'reason': 'not_found'}]
    assert not ParentChild.objects.filter(student=foreign).exists()


def test_unlink_other_school_link_is_404(api, seed_data):
    s = seed_data
    parent = _make_parent(s)
    link = _link(parent, s['students'][0], s['school_a'])
    resp = api.delete(f'/api/parents/admin/unlink-child/{link.id}/', s['tokens']['admin_b'], s['SID_B'])
    assert resp.status_code == 404
    assert ParentChild.objects.filter(id=link.id).exists()


def test_primary_is_exclusive_per_child(api, seed_data):
    s = seed_data
    student = s['students'][0]
    father, mother = _make_parent(s, 'f'), _make_parent(s, 'm')
    l1 = _link(father, student, s['school_a'], is_primary=True)
    l2 = _link(mother, student, s['school_a'])
    resp = api.patch(f'/api/parents/admin/links/{l2.id}/', {'is_primary': True}, s['tokens']['admin'], s['SID_A'])
    assert resp.status_code == 200
    l1.refresh_from_db()
    assert l1.is_primary is False


def test_parent_list_child_count_and_multi_filter(api, seed_data):
    s = seed_data
    two, one = _make_parent(s, 'two'), _make_parent(s, 'one')
    _link(two, s['students'][0], s['school_a'])
    _link(two, s['students'][1], s['school_a'])
    _link(one, s['students'][2], s['school_a'])

    resp = api.get('/api/parents/admin/parents/?children=multi', s['tokens']['admin'], s['SID_A'])
    data = resp.json()
    assert [r['child_count'] for r in data] == [2]


def test_sibling_suggestion_needs_name_and_phone(api, seed_data):
    s = seed_data
    ali, sara, usman, fatima = s['students'][:4]
    Student.objects.filter(id=ali.id).update(parent_name='Mr  Khan', parent_phone='0300-1234567')
    # name + phone match (different formatting) -> suggested
    Student.objects.filter(id=sara.id).update(guardian_name='mr khan', guardian_phone='03001234567')
    # phone only -> not suggested
    Student.objects.filter(id=usman.id).update(parent_name='Someone Else', parent_phone='03001234567')
    # name only -> not suggested
    Student.objects.filter(id=fatima.id).update(parent_name='Mr Khan', parent_phone='03119999999')

    resp = api.get(f'/api/parents/admin/sibling-suggestions/?student_id={ali.id}', s['tokens']['admin'], s['SID_A'])
    assert resp.status_code == 200
    assert [r['student_id'] for r in resp.json()] == [sara.id]


def test_sibling_suggestion_excludes_already_linked(api, seed_data):
    s = seed_data
    ali, sara = s['students'][:2]
    for st in (ali, sara):
        Student.objects.filter(id=st.id).update(parent_name='Mr Khan', parent_phone='03001234567')
    parent = _make_parent(s)
    _link(parent, ali, s['school_a'])
    _link(parent, sara, s['school_a'])
    resp = api.get(
        f'/api/parents/admin/sibling-suggestions/?student_id={ali.id}&parent_profile_id={parent.id}',
        s['tokens']['admin'], s['SID_A'],
    )
    assert resp.json() == []


def test_invite_list_and_revoke(api, seed_data):
    s = seed_data
    student = s['students'][0]
    resp = api.post(
        '/api/parents/admin/generate-invite/', {'student_id': student.id, 'relation': 'FATHER'},
        s['tokens']['admin'], s['SID_A'],
    )
    assert resp.status_code == 201
    listing = api.get(f'/api/parents/admin/generate-invite/?student_id={student.id}', s['tokens']['admin'], s['SID_A'])
    assert len(listing.json()) == 1
    invite_id = listing.json()[0]['id']

    assert api.delete(f'/api/parents/admin/invites/{invite_id}/', s['tokens']['admin_b'], s['SID_B']).status_code == 404
    assert api.delete(f'/api/parents/admin/invites/{invite_id}/', s['tokens']['admin'], s['SID_A']).status_code == 204
    assert not ParentInvite.objects.filter(id=invite_id).exists()


def test_parent_status_counts_links_and_pending_invites(api, seed_data):
    s = seed_data
    a, b = s['students'][:2]
    _link(_make_parent(s), a, s['school_a'])
    api.post('/api/parents/admin/generate-invite/', {'student_id': b.id, 'relation': 'MOTHER'},
             s['tokens']['admin'], s['SID_A'])
    body = api.get('/api/parents/admin/parent-status/', s['tokens']['admin'], s['SID_A']).json()
    assert body[str(a.id)] == {'linked': 1, 'pending': 0}
    assert body[str(b.id)] == {'linked': 0, 'pending': 1}
    assert str(s['students'][2].id) not in body


def test_invite_for_other_school_student_is_404(api, seed_data):
    s = seed_data
    resp = api.post(
        '/api/parents/admin/generate-invite/', {'student_id': s['students'][0].id, 'relation': 'FATHER'},
        s['tokens']['admin_b'], s['SID_B'],
    )
    assert resp.status_code == 404
