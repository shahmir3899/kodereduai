"""
Face Attendance — registering capture devices from the app
==========================================================
Covers: POST /devices/ (admin-only create, raw key returned once), scope rules,
the new key actually authenticating the live-match call, and key rotation.

Run:
    cd backend
    pytest tests/test_face_attendance_device_registration.py -v
"""

import json
from datetime import datetime, timezone as dt_timezone

import pytest

from face_attendance.models import FaceCaptureDevice

DEVICES_URL = '/api/face-attendance/devices/'
LIVE_MATCH_URL = '/api/face-attendance/live/match/'


def _create(api, seed_data, payload, token=None, school=None):
    return api.post(
        DEVICES_URL, payload,
        token or seed_data['tokens']['admin'], school or seed_data['SID_A'],
    )


def _scan_with_key(api_client, raw_key, version='faceapi_v1'):
    return api_client.post(
        LIVE_MATCH_URL,
        data=json.dumps({
            'embedding': [0.0] * 128,
            'embedding_version': version,
            'timestamp': datetime.now(dt_timezone.utc).isoformat(),
        }),
        content_type='application/json',
        headers={'X-Device-Key': raw_key},
    )


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestCreateDevice:
    def test_admin_registers_a_whole_school_browser_device_and_gets_the_key_once(self, seed_data, api):
        resp = _create(api, seed_data, {'name': 'Front Gate Tablet', 'scope_type': 'SCHOOL'})

        assert resp.status_code == 201, resp.content
        body = resp.json()
        assert body['api_key'] and len(body['api_key']) >= 32
        assert body['name'] == 'Front Gate Tablet'
        assert body['scope_type'] == 'SCHOOL' and body['class_obj'] is None
        assert body['embedding_version'] == 'faceapi_v1'  # browser/tablet is the default

        device = FaceCaptureDevice.objects.get(pk=body['id'])
        assert device.school_id == seed_data['school_a'].id
        assert device.created_by_id == seed_data['users']['admin'].id
        # Only the hash is stored — never the raw key.
        assert device.api_key_hash == FaceCaptureDevice.hash_api_key(body['api_key'])
        assert body['api_key'] not in (device.api_key_hash, device.name)

        # The key is not retrievable afterwards.
        listing = api.get(DEVICES_URL, seed_data['tokens']['admin'], seed_data['SID_A']).json()
        rows = listing['results'] if isinstance(listing, dict) else listing
        assert all('api_key' not in row for row in rows)

    def test_class_scoped_device_needs_a_class_from_this_school(self, seed_data, api):
        class_obj = seed_data['classes'][0]
        ok = _create(api, seed_data, {'name': 'Room 1', 'scope_type': 'CLASS', 'class_obj': class_obj.id})
        assert ok.status_code == 201, ok.content
        assert ok.json()['class_obj'] == class_obj.id

        missing = _create(api, seed_data, {'name': 'Room 2', 'scope_type': 'CLASS'})
        assert missing.status_code == 400

    def test_whole_school_device_ignores_a_class(self, seed_data, api):
        resp = _create(api, seed_data, {
            'name': 'Entrance', 'scope_type': 'SCHOOL', 'class_obj': seed_data['classes'][0].id,
        })
        assert resp.status_code == 201, resp.content
        assert resp.json()['class_obj'] is None

    def test_on_prem_device_uses_the_dlib_embedding_space(self, seed_data, api):
        resp = _create(api, seed_data, {
            'name': 'Mini PC', 'scope_type': 'SCHOOL', 'embedding_version': 'dlib_v1',
        })
        assert resp.status_code == 201
        assert resp.json()['embedding_version'] == 'dlib_v1'

    def test_unknown_embedding_version_and_blank_name_are_rejected(self, seed_data, api):
        assert _create(api, seed_data, {'name': 'X', 'scope_type': 'SCHOOL', 'embedding_version': 'nope'}).status_code == 400
        assert _create(api, seed_data, {'name': '   ', 'scope_type': 'SCHOOL'}).status_code == 400
        assert not FaceCaptureDevice.objects.exists()

    def test_teacher_cannot_register_a_device(self, seed_data, api):
        token = api.login(f"{seed_data['prefix']}staff_teacher1")
        resp = _create(api, seed_data, {'name': 'Sneaky', 'scope_type': 'SCHOOL'}, token=token)
        assert resp.status_code == 403
        assert not FaceCaptureDevice.objects.exists()

    def test_unauthenticated_is_rejected(self, seed_data, api):
        resp = api.client.post(
            DEVICES_URL, data=json.dumps({'name': 'X', 'scope_type': 'SCHOOL'}), content_type='application/json',
        )
        assert resp.status_code in (401, 403)


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestNewDeviceWorks:
    def test_the_returned_key_authenticates_a_live_scan(self, seed_data, api, api_client):
        key = _create(api, seed_data, {'name': 'Gate', 'scope_type': 'SCHOOL'}).json()['api_key']

        # No students are enrolled in faceapi_v1 yet, so this is a valid scan with no match —
        # what matters is that the key is accepted (a bad key would be 401).
        resp = _scan_with_key(api_client, key)
        assert resp.status_code == 200, resp.content
        assert resp.json()['match_status'] == 'IGNORED'

    def test_a_scan_in_the_wrong_embedding_space_is_refused(self, seed_data, api, api_client):
        key = _create(api, seed_data, {'name': 'Gate', 'scope_type': 'SCHOOL'}).json()['api_key']
        assert _scan_with_key(api_client, key, version='dlib_v1').status_code == 400

    def test_a_deactivated_device_stops_working(self, seed_data, api, api_client):
        created = _create(api, seed_data, {'name': 'Gate', 'scope_type': 'SCHOOL'}).json()
        api.patch(f"{DEVICES_URL}{created['id']}/", {'is_active': False}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert _scan_with_key(api_client, created['api_key']).status_code == 401


@pytest.mark.django_db
@pytest.mark.face_attendance
class TestRotateKey:
    def test_rotating_replaces_the_key_immediately(self, seed_data, api, api_client):
        created = _create(api, seed_data, {'name': 'Gate', 'scope_type': 'SCHOOL'}).json()
        old_key = created['api_key']

        resp = api.post(
            f"{DEVICES_URL}{created['id']}/rotate_key/", {}, seed_data['tokens']['admin'], seed_data['SID_A'],
        )
        assert resp.status_code == 200, resp.content
        new_key = resp.json()['api_key']
        assert new_key and new_key != old_key

        assert _scan_with_key(api_client, old_key).status_code == 401
        assert _scan_with_key(api_client, new_key).status_code == 200

    def test_another_schools_admin_cannot_rotate_it(self, seed_data, api):
        created = _create(api, seed_data, {'name': 'Gate', 'scope_type': 'SCHOOL'}).json()
        resp = api.post(
            f"{DEVICES_URL}{created['id']}/rotate_key/", {},
            seed_data['tokens']['admin_b'], seed_data['SID_B'],
        )
        assert resp.status_code == 404
        device = FaceCaptureDevice.objects.get(pk=created['id'])
        assert device.api_key_hash == FaceCaptureDevice.hash_api_key(created['api_key'])
