"""Thread creation honours the same recipient rules as the picker."""
import pytest

pytestmark = pytest.mark.django_db


def _body(user_id, **extra):
    return {'recipient_user_id': user_id, 'message': 'Hello', **extra}


def test_staff_cannot_message_a_non_admin_by_id(seed_data, api):
    sid = seed_data['SID_A']
    token = seed_data['tokens']['staff']
    target = seed_data['users']['accountant']
    response = api.post('/api/messaging/threads/', _body(target.id), token, sid)
    assert response.status_code == 403, response.content[:200]


def test_staff_can_message_an_admin(seed_data, api):
    sid = seed_data['SID_A']
    token = seed_data['tokens']['staff']
    admin = seed_data['users']['admin']
    response = api.post('/api/messaging/threads/', _body(admin.id), token, sid)
    assert response.status_code == 201, response.content[:200]


def test_picker_and_create_agree_for_admin(seed_data, api):
    sid = seed_data['SID_A']
    token = seed_data['tokens']['admin']
    rows = api.get('/api/messaging/recipients/', token, sid).json()
    assert rows
    response = api.post('/api/messaging/threads/', _body(rows[0]['id']), token, sid)
    assert response.status_code in (200, 201), response.content[:200]
