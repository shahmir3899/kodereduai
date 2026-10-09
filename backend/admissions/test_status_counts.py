"""The enquiries page needs one count per status. status-counts gives all of them in a
single grouped query instead of one list request each."""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from admissions.models import AdmissionEnquiry

pytestmark = pytest.mark.django_db

URL = '/api/admissions/enquiries/status-counts/'


def enquire(school, n, status):
    for i in range(n):
        AdmissionEnquiry.objects.create(
            school=school, name=f'ZZ_{status}_{i}', father_name='F', mobile='0300', status=status,
        )


@pytest.fixture
def enquiries(seed_data):
    enquire(seed_data['school_a'], 3, 'NEW')
    enquire(seed_data['school_a'], 2, 'CONFIRMED')
    enquire(seed_data['school_a'], 1, 'CANCELLED')
    enquire(seed_data['school_b'], 5, 'NEW')  # another school's: must not be counted
    return seed_data


def get(api, ctx, token='admin'):
    return api.get(URL, ctx['tokens'][token], ctx['SID_A'])


def test_counts_every_status_for_the_active_school_only(api, enquiries):
    resp = get(api, enquiries)

    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert {k: body[k] for k in ('NEW', 'CONFIRMED', 'CONVERTED', 'CANCELLED')} == {
        'NEW': 3, 'CONFIRMED': 2, 'CONVERTED': 0, 'CANCELLED': 1,
    }
    assert body['total'] == 6


def test_counts_match_what_the_list_endpoint_reports(api, enquiries):
    body = get(api, enquiries).json()

    for status in ('NEW', 'CONFIRMED', 'CANCELLED'):
        listed = api.get(f'/api/admissions/enquiries/?status={status}&page_size=1',
                         enquiries['tokens']['admin'], enquiries['SID_A']).json()
        assert listed['count'] == body[status]


def test_it_is_one_query_for_the_counts(api, enquiries):
    get(api, enquiries)  # warm
    with CaptureQueriesContext(connection) as q:
        get(api, enquiries)

    counting = [x for x in q.captured_queries if 'admissions_admissionenquiry' in x['sql'].lower()]
    assert len(counting) == 1, [x['sql'][:90] for x in counting]


def test_it_requires_a_login(api, enquiries):
    assert api.get_no_auth(URL).status_code == 401
