"""Public school directory used by the phone app's "Find your school" name search."""
import pytest
from django.core.cache import cache

from schools.views import SCHOOL_DIRECTORY_CACHE_KEY

URL = '/api/schools/directory/'


@pytest.fixture(autouse=True)
def _fresh_directory_cache():
    # The list is cached for everyone; each test starts from the database.
    cache.delete(SCHOOL_DIRECTORY_CACHE_KEY)
    yield
    cache.delete(SCHOOL_DIRECTORY_CACHE_KEY)


@pytest.mark.django_db
def test_lists_active_schools_with_only_search_fields(seed_data, api_client):
    res = api_client.get(URL)
    assert res.status_code == 200
    rows = res.json()
    codes = {r['code'] for r in rows}
    assert seed_data['school_a'].subdomain in codes
    assert seed_data['school_b'].subdomain in codes
    # Nothing beyond what the search needs (no address, phone, email, id).
    assert all(set(r) == {'code', 'name', 'logo'} for r in rows)


@pytest.mark.django_db
def test_hides_inactive_schools(seed_data, api_client):
    school = seed_data['school_b']
    school.is_active = False
    school.save(update_fields=['is_active'])
    codes = {r['code'] for r in api_client.get(URL).json()}
    assert school.subdomain not in codes
    assert seed_data['school_a'].subdomain in codes


@pytest.mark.django_db
def test_needs_no_sign_in_and_ignores_a_stale_token(seed_data, api_client):
    res = api_client.get(URL, HTTP_AUTHORIZATION='Bearer not-a-real-token')
    assert res.status_code == 200


@pytest.mark.django_db
def test_same_etag_gets_not_modified(seed_data, api_client):
    first = api_client.get(URL)
    etag = first['ETag']
    assert etag
    again = api_client.get(URL, HTTP_IF_NONE_MATCH=etag)
    assert again.status_code == 304
    assert again.content == b''
    # A different (old) ETag gets the full list.
    assert api_client.get(URL, HTTP_IF_NONE_MATCH='"old"').status_code == 200
