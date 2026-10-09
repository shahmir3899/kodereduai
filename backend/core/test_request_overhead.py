"""Every API request used to repeat the same school/membership lookups (5 of the 8
queries of a plain class list). The role is now looked up once per request and the
module check loads the school with its organization in one query."""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIRequestFactory

from core.permissions import get_effective_role

pytestmark = pytest.mark.django_db


def queries_for(api, ctx, url):
    api.get(url, ctx['tokens']['admin'], ctx['SID_A'])  # warm
    with CaptureQueriesContext(connection) as q:
        resp = api.get(url, ctx['tokens']['admin'], ctx['SID_A'])
    assert resp.status_code == 200, resp.content
    return q


def test_a_plain_list_no_longer_repeats_membership_lookups(api, seed_data):
    q = queries_for(api, seed_data, '/api/attendance/records/my_classes/')

    memberships = [x for x in q.captured_queries if 'userschoolmembership' in x['sql'].lower()]
    assert len(memberships) <= 2, [x['sql'][:80] for x in memberships]
    assert len(q) <= 7, f'{len(q)} queries'  # was 8 on live data before the role cache


def test_the_school_and_its_organization_load_together(api, seed_data):
    q = queries_for(api, seed_data, '/api/attendance/records/my_classes/')

    assert not [x for x in q.captured_queries if x['sql'].lower().startswith('select') and 'from "schools_organization"' in x['sql'].lower()
                and 'join' not in x['sql'].lower()]


class TestEffectiveRoleIsLookedUpOnce:
    def make_request(self, seed_data, who='teacher'):
        request = APIRequestFactory().get('/', HTTP_X_SCHOOL_ID=str(seed_data['SID_A']))
        request.user = seed_data['users'][who]
        return request

    def test_second_call_in_a_request_costs_nothing(self, seed_data):
        request = self.make_request(seed_data)
        first = get_effective_role(request)

        with CaptureQueriesContext(connection) as q:
            second = get_effective_role(request)

        assert first == second == 'TEACHER'
        assert len(q) == 0

    def test_a_role_change_is_seen_by_the_next_request(self, seed_data):
        from schools.models import UserSchoolMembership

        user = seed_data['users']['teacher']
        assert get_effective_role(self.make_request(seed_data)) == 'TEACHER'

        UserSchoolMembership.objects.filter(user=user, school_id=seed_data['SID_A']).update(role='ACCOUNTANT')

        assert get_effective_role(self.make_request(seed_data)) == 'ACCOUNTANT'

    def test_the_fallback_to_the_users_own_role_is_unchanged(self, seed_data):
        request = APIRequestFactory().get('/')  # no school header, so no membership lookup
        request.user = seed_data['users']['teacher']

        assert get_effective_role(request) == seed_data['users']['teacher'].role
