"""The Add Student form creates the student, then the student's login from the id in the create
response; and reads `session_class_obj` from the list as a plain section id (shared seed school)."""
import pytest

from students.models import Student, StudentProfile
from users.models import User


@pytest.mark.django_db
def test_create_response_carries_the_new_students_id(api, seed_data):
    resp = api.post('/api/students/', {
        'school': seed_data['SID_A'], 'class_obj': seed_data['classes'][2].id,
        'name': 'Id Probe', 'roll_number': '31',
    }, seed_data['tokens']['admin'], seed_data['SID_A'])
    assert resp.status_code == 201, resp.content
    assert Student.objects.get(pk=resp.json()['id']).name == 'Id Probe'


@pytest.mark.django_db
def test_login_can_be_created_from_the_create_response(api, seed_data):
    admin, sid = seed_data['tokens']['admin'], seed_data['SID_A']
    created = api.post('/api/students/', {
        'school': sid, 'class_obj': seed_data['classes'][2].id, 'name': 'Login Probe', 'roll_number': '32',
    }, admin, sid)
    student_id = created.json()['id']

    account = api.post(f'/api/students/{student_id}/create-user-account/', {
        'username': 'login_probe', 'password': seed_data['password'], 'confirm_password': seed_data['password'],
    }, admin, sid)
    assert account.status_code == 201, account.content

    user = User.objects.get(username='login_probe')
    assert StudentProfile.objects.get(user=user).student_id == student_id
    assert user.get_role_for_school(sid) == 'STUDENT'
    assert api.login('login_probe')


@pytest.mark.django_db
def test_students_list_gives_the_section_as_a_plain_id(api, seed_data, seed_sections):
    resp = api.get(
        f"/api/students/?page_size=100&academic_year={seed_data['academic_year'].id}",
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )
    rows = {r['id']: r for r in resp.json()['results']}
    # The Add Student form and the transport picker compare this value directly.
    assert rows[seed_sections['a_students'][0].id]['session_class_obj'] == seed_sections['section_a'].id
    assert rows[seed_sections['b_students'][0].id]['session_class_obj'] == seed_sections['section_b'].id
