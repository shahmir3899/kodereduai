"""
Each school has its own clock (School.timezone, Asia/Karachi by default).

Run:
    cd backend
    pytest tests/test_school_timezone.py -v
"""
from datetime import datetime, timezone as dt_timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from django.core.exceptions import ValidationError
from django.test import RequestFactory
from django.utils import timezone

from core.middleware import TenantMiddleware
from core.school_time import school_now, school_timezone, school_today
from schools.models import School

# 02:00 on 30 Oct in Karachi, still the evening of 29 Oct in New York
INSTANT = datetime(2026, 10, 29, 21, 0, tzinfo=dt_timezone.utc)


@pytest.fixture
def new_york(db):
    return School.objects.create(name='PYTEST NY', subdomain='pytest-ny', timezone='America/New_York')


@pytest.mark.django_db
class TestSchoolTimezone:
    def test_new_schools_default_to_pakistan_time(self, db):
        school = School.objects.create(name='PYTEST PK', subdomain='pytest-pk')
        assert school.timezone == 'Asia/Karachi'

    def test_seeded_schools_are_on_pakistan_time(self, seed_data):
        assert School.objects.get(id=seed_data['SID_A']).timezone == 'Asia/Karachi'

    def test_a_made_up_zone_is_rejected(self, new_york):
        new_york.timezone = 'Mars/Olympus'
        with pytest.raises(ValidationError):
            new_york.full_clean()

    def test_today_follows_the_schools_zone(self, seed_data, new_york):
        with patch('django.utils.timezone.now', return_value=INSTANT):
            assert school_today(seed_data['SID_A']).isoformat() == '2026-10-30'
            assert school_today(new_york.id).isoformat() == '2026-10-29'
            assert school_now(new_york.id).utcoffset().total_seconds() == -4 * 3600

    def test_block_helper_switches_localdate(self, new_york):
        with patch('django.utils.timezone.now', return_value=INSTANT):
            assert timezone.localdate().isoformat() == '2026-10-30'
            with school_timezone(new_york.id):
                assert timezone.localdate().isoformat() == '2026-10-29'
            assert timezone.localdate().isoformat() == '2026-10-30'

    def test_changing_the_zone_applies_at_once(self, new_york):
        assert school_today(new_york.id) is not None  # warms the cache
        new_york.timezone = 'Asia/Karachi'
        new_york.save()
        with patch('django.utils.timezone.now', return_value=INSTANT):
            assert school_today(new_york.id).isoformat() == '2026-10-30'


@pytest.mark.django_db
class TestMiddleware:
    def test_request_runs_on_the_schools_clock_and_resets_after(self, new_york):
        mw = TenantMiddleware(lambda r: None)
        request = RequestFactory().get('/api/anything/', HTTP_X_SCHOOL_ID=str(new_york.id))
        request.tenant_school_id = None
        mw.process_request(request)
        mw.process_view(request, None, (), {})
        assert timezone.get_current_timezone_name() == 'America/New_York'
        mw.process_response(request, object())
        assert timezone.get_current_timezone_name() == 'Asia/Karachi'

    def test_login_payload_carries_the_zone(self, seed_data, api):
        resp = api.client.post('/api/auth/login/', data='{"username": "PYTEST_admin", "password": "TestPass123!"}',
                               content_type='application/json')
        body = resp.json()
        schools = body['user']['schools']
        assert schools and all(s.get('timezone') for s in schools)


@pytest.mark.django_db
class TestTimeZoneEndpoint:
    URL = '/api/schools/time_zone/'

    def test_admin_can_change_it(self, seed_data, api):
        resp = api.client.put(self.URL, data='{"timezone": "Asia/Dubai"}', content_type='application/json',
                              HTTP_AUTHORIZATION=f"Bearer {seed_data['tokens']['admin']}", HTTP_X_SCHOOL_ID=str(seed_data['SID_A']))
        assert resp.status_code == 200
        assert School.objects.get(id=seed_data['SID_A']).timezone == 'Asia/Dubai'

    def test_nonsense_zone_is_refused(self, seed_data, api):
        resp = api.client.put(self.URL, data='{"timezone": "Mars/Olympus"}', content_type='application/json',
                              HTTP_AUTHORIZATION=f"Bearer {seed_data['tokens']['admin']}", HTTP_X_SCHOOL_ID=str(seed_data['SID_A']))
        assert resp.status_code == 400

    def test_teacher_cannot_change_it(self, seed_data, api):
        resp = api.client.put(self.URL, data='{"timezone": "Asia/Dubai"}', content_type='application/json',
                              HTTP_AUTHORIZATION=f"Bearer {seed_data['tokens']['teacher']}", HTTP_X_SCHOOL_ID=str(seed_data['SID_A']))
        assert resp.status_code == 403
        assert School.objects.get(id=seed_data['SID_A']).timezone == 'Asia/Karachi'
