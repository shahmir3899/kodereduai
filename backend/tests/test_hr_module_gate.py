"""
HR module gate — regression coverage for the ModuleAccessMixin fix.
=====================================================================
Confirms the fix on a real, registered endpoint (not just the shared mixin
unit tests in test_module_access_mixin.py) -- hr is one of the two
highest-count, highest-sensitivity apps using ModuleAccessMixin.

Run:
    cd backend
    pytest tests/test_hr_module_gate.py -v
"""

import pytest

DEPARTMENTS_URL = '/api/hr/departments/'


@pytest.mark.django_db
class TestHRModuleGate:
    def test_hr_disabled_returns_403_on_real_endpoint(self, seed_data, api):
        school = seed_data['school_a']
        school.enabled_modules['hr'] = False
        school.save(update_fields=['enabled_modules'])

        resp = api.get(DEPARTMENTS_URL, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 403

    def test_hr_enabled_by_default_returns_200(self, seed_data, api):
        resp = api.get(DEPARTMENTS_URL, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200

    def test_disabling_hr_does_not_affect_other_schools(self, seed_data, api):
        """school_b's hr module is untouched -- the gate is per-school, not global."""
        school_a = seed_data['school_a']
        school_a.enabled_modules['hr'] = False
        school_a.save(update_fields=['enabled_modules'])

        resp = api.get(DEPARTMENTS_URL, seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200
