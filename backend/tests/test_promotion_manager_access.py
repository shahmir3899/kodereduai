"""
A Manager runs promotion end to end (owner's call, 2026-10-29), but only the promotion
actions: plain enrollment writes stay admin/principal, and Accountant/Teacher stay out.

Run:
    cd backend
    pytest tests/test_promotion_manager_access.py -v
"""

import pytest

BULK_PROMOTE = '/api/sessions/enrollments/bulk_promote/'
ENROLLMENTS = '/api/sessions/enrollments/'


@pytest.mark.django_db
class TestPromotionAccess:
    @pytest.mark.parametrize('role', ['admin', 'principal', 'manager'])
    def test_promotion_roles_pass_the_permission_gate(self, seed_data, api, role):
        # An empty body fails validation (400); the point is that it is not a 403.
        resp = api.post(BULK_PROMOTE, {}, seed_data['tokens'][role], seed_data['SID_A'])
        assert resp.status_code == 400

    @pytest.mark.parametrize('role', ['accountant', 'teacher', 'staff'])
    def test_other_roles_are_denied(self, seed_data, api, role):
        resp = api.post(BULK_PROMOTE, {}, seed_data['tokens'][role], seed_data['SID_A'])
        assert resp.status_code == 403

    def test_manager_cannot_write_plain_enrollments(self, seed_data, api):
        resp = api.post(ENROLLMENTS, {}, seed_data['tokens']['manager'], seed_data['SID_A'])
        assert resp.status_code == 403
