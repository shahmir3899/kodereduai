"""
The phone app's school front door: search by name or code, exact code lookup, and the admin's
"show my school in the app" switch.

Run:
    cd backend
    pytest tests/test_school_app_lookup.py -v
"""
import json

import pytest
from django.core.cache import cache

from schools.models import School

SEARCH = '/api/schools/app-search/'
INFO = '/api/schools/app-info/'
LISTING = '/api/schools/app-listing/'
DIRECTORY = '/api/schools/app-directory/'


@pytest.fixture(autouse=True)
def _fresh_throttle():
    # The throttle counts calls in the cache; each test starts with a clean count.
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def schools(db):
    listed = School.objects.create(name='Oakwood Academy', subdomain='oakwood', logo='https://x.test/oak.png', listed_in_app=True)
    School.objects.create(name='Oakridge Private', subdomain='oakridge', listed_in_app=True)
    School.objects.create(name='Hidden Oaks School', subdomain='hidden', listed_in_app=False)
    School.objects.create(name='Closed Oaks', subdomain='closedoaks', is_active=False, listed_in_app=True)
    return listed


@pytest.mark.django_db
class TestSearch:
    def test_needs_no_login_and_returns_only_public_fields(self, client, schools):
        resp = client.get(SEARCH, {'q': 'oakw'})
        assert resp.status_code == 200
        assert resp.json() == [{'subdomain': 'oakwood', 'name': 'Oakwood Academy', 'logo': 'https://x.test/oak.png'}]

    def test_finds_by_name_or_the_start_of_the_code(self, client, schools):
        assert [s['subdomain'] for s in client.get(SEARCH, {'q': 'academy'}).json()] == ['oakwood']
        assert [s['subdomain'] for s in client.get(SEARCH, {'q': 'oakr'}).json()] == ['oakridge']

    def test_leaves_out_unlisted_and_inactive_schools(self, client, schools):
        found = [s['subdomain'] for s in client.get(SEARCH, {'q': 'oak'}).json()]
        assert sorted(found) == ['oakridge', 'oakwood']

    def test_short_or_missing_text_returns_nothing(self, client, schools):
        assert client.get(SEARCH, {'q': 'oa'}).json() == []
        assert client.get(SEARCH, {'q': '  '}).json() == []
        assert client.get(SEARCH).json() == []

    def test_never_returns_more_than_a_handful(self, client, db):
        for i in range(15):
            School.objects.create(name=f'Bright School {i:02d}', subdomain=f'bright{i}', listed_in_app=True)
        assert len(client.get(SEARCH, {'q': 'bright'}).json()) == 8

    def test_is_throttled(self, client, schools):
        statuses = [client.get(SEARCH, {'q': 'oak'}).status_code for _ in range(40)]
        assert 429 in statuses


@pytest.mark.django_db
class TestInfo:
    def test_finds_a_school_by_exact_code_even_when_not_listed(self, client, schools):
        resp = client.get(INFO, {'code': 'hidden'})
        assert resp.status_code == 200
        assert resp.json() == {'subdomain': 'hidden', 'name': 'Hidden Oaks School', 'logo': None}

    def test_ignores_case_and_spaces(self, client, schools):
        assert client.get(INFO, {'code': ' OakWood '}).json()['subdomain'] == 'oakwood'

    def test_unknown_or_inactive_code_is_not_found(self, client, schools):
        assert client.get(INFO, {'code': 'nope'}).status_code == 404
        assert client.get(INFO, {'code': 'closedoaks'}).status_code == 404

    def test_a_missing_code_is_a_bad_request(self, client, schools):
        assert client.get(INFO).status_code == 400

    def test_does_not_leak_private_fields(self, client, schools):
        body = client.get(INFO, {'code': 'oakwood'}).json()
        assert set(body) == {'subdomain', 'name', 'logo'}


@pytest.mark.django_db
class TestListingSwitch:
    def test_an_admin_can_read_and_change_it(self, api, seed_data):
        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        assert api.get(LISTING, token, sid).json() == {'listed_in_app': False}
        resp = api.client.put(
            LISTING, data=json.dumps({'listed_in_app': True}), content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_SCHOOL_ID=str(sid),
        )
        assert resp.status_code == 200
        assert School.objects.get(id=sid).listed_in_app is True

    def test_a_teacher_cannot_change_it(self, api, seed_data):
        token, sid = seed_data['tokens']['teacher'], seed_data['SID_A']
        resp = api.client.put(
            LISTING, data=json.dumps({'listed_in_app': True}), content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_SCHOOL_ID=str(sid),
        )
        assert resp.status_code == 403
        assert School.objects.get(id=sid).listed_in_app is False

    def test_it_must_be_a_real_true_or_false(self, api, seed_data):
        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        resp = api.client.put(
            LISTING, data=json.dumps({'listed_in_app': 'yes'}), content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_SCHOOL_ID=str(sid),
        )
        assert resp.status_code == 400

    def test_login_is_required(self, client, db):
        assert client.get(LISTING).status_code in (401, 403)


@pytest.mark.django_db
class TestDirectory:
    def test_lists_only_opted_in_active_schools_with_public_fields(self, client, schools):
        body = client.get(DIRECTORY).json()
        assert [s['subdomain'] for s in body] == ['oakridge', 'oakwood'] or [s['subdomain'] for s in body] == ['oakwood', 'oakridge']
        assert all(set(s) == {'subdomain', 'name', 'logo'} for s in body)
        assert 'hidden' not in [s['subdomain'] for s in body]
        assert 'closedoaks' not in [s['subdomain'] for s in body]

    def test_needs_no_login(self, client, schools):
        assert client.get(DIRECTORY).status_code == 200

    def test_is_sorted_by_name(self, client, db):
        School.objects.create(name='Zed School', subdomain='zed', listed_in_app=True)
        School.objects.create(name='Alpha School', subdomain='alpha', listed_in_app=True)
        assert [s['name'] for s in client.get(DIRECTORY).json()] == ['Alpha School', 'Zed School']

    def test_is_capped(self, client, db, monkeypatch):
        from schools.views import SchoolViewSet
        monkeypatch.setattr(SchoolViewSet, 'APP_DIRECTORY_LIMIT', 3)
        for i in range(6):
            School.objects.create(name=f'School {i}', subdomain=f'cap{i}', listed_in_app=True)
        assert len(client.get(DIRECTORY).json()) == 3

    def test_switching_the_listing_refreshes_the_cached_list(self, api, client, seed_data):
        token, sid = seed_data['tokens']['admin'], seed_data['SID_A']
        code = School.objects.get(id=sid).subdomain
        assert code not in [s['subdomain'] for s in client.get(DIRECTORY).json()]
        resp = api.client.put(
            LISTING, data=json.dumps({'listed_in_app': True}), content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_SCHOOL_ID=str(sid),
        )
        assert resp.status_code == 200
        assert code in [s['subdomain'] for s in client.get(DIRECTORY).json()]
