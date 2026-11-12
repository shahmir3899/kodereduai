"""
Recent-entries feed access — the finance_manager dashboard (and the finance_manager login
prefetch) call this endpoint, but it used to be School-Admin-only, so finance managers
got a 403 on every dashboard load.

Run:
    cd backend
    pytest tests/test_finance_recent_entries_access.py -v
"""

import pytest

URL = '/api/finance/accounts/recent_entries/?limit=8'


@pytest.mark.django_db
class TestRecentEntriesAccess:
    @pytest.mark.parametrize('role', ['admin', 'principal', 'finance_manager'])
    def test_finance_roles_can_read(self, seed_data, api, role):
        resp = api.get(URL, seed_data['tokens'][role], seed_data['SID_A'])
        assert resp.status_code == 200

    @pytest.mark.parametrize('role', ['manager', 'teacher'])
    def test_non_finance_roles_are_denied(self, seed_data, api, role):
        resp = api.get(URL, seed_data['tokens'][role], seed_data['SID_A'])
        assert resp.status_code == 403

    def test_finance_manager_scope_matches_admin_scope_across_schools(self, seed_data, api):
        """Widening the role must not widen the tenant: a foreign X-School-ID gives
        a finance manager nothing from school B: the capability is read from the membership in the
        requested school, so without one there is no finance access at all."""
        acc = api.get(URL, seed_data['tokens']['finance_manager'], seed_data['SID_B'])
        assert acc.status_code == 403


CLOSINGS_URL = '/api/finance/accounts/closings/'
CLOSE_URL = '/api/finance/accounts/close_month/'
REOPEN_URL = '/api/finance/accounts/999999/reopen/'


@pytest.mark.django_db
class TestMonthClosingAccess:
    """Finance managers may read which months are closed, but closing/reopening stays admin-only."""

    @pytest.mark.parametrize('role', ['admin', 'principal', 'finance_manager'])
    def test_finance_roles_can_list_closings(self, seed_data, api, role):
        resp = api.get(CLOSINGS_URL, seed_data['tokens'][role], seed_data['SID_A'])
        assert resp.status_code == 200

    @pytest.mark.parametrize('role', ['manager', 'teacher'])
    def test_non_finance_roles_cannot_list_closings(self, seed_data, api, role):
        resp = api.get(CLOSINGS_URL, seed_data['tokens'][role], seed_data['SID_A'])
        assert resp.status_code == 403

    def test_finance_manager_cannot_close_a_month(self, seed_data, api):
        resp = api.post(CLOSE_URL, {'month': 1, 'year': 2020}, seed_data['tokens']['finance_manager'], seed_data['SID_A'])
        assert resp.status_code == 403

    def test_finance_manager_cannot_reopen_a_month(self, seed_data, api):
        resp = api.delete(REOPEN_URL, seed_data['tokens']['finance_manager'], seed_data['SID_A'])
        assert resp.status_code == 403
