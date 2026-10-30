"""
FINANCE_SUMMARY report: one server-made PDF for web and mobile.

Run:
    cd backend
    pytest tests/test_finance_summary_report.py -v
"""

import pytest

INSTANT = '/api/reports/generate-instant/'
BACKGROUND = '/api/reports/generate/'
BODY = {
    'report_type': 'FINANCE_SUMMARY',
    'parameters': {'date_from': '2026-01-01', 'date_to': '2026-12-31', 'period_label': 'This Year'},
}


@pytest.mark.django_db
class TestFinanceSummaryReport:
    @pytest.mark.parametrize('role', ['admin', 'principal'])
    def test_admin_roles_get_a_pdf(self, seed_data, api, role):
        resp = api.post(INSTANT, BODY, seed_data['tokens'][role], seed_data['SID_A'])
        assert resp.status_code == 200, resp.content[:300]
        assert resp['Content-Type'] == 'application/pdf'
        assert resp.content.startswith(b'%PDF')

    @pytest.mark.parametrize('role', ['accountant', 'manager', 'teacher'])
    def test_other_roles_are_refused(self, seed_data, api, role):
        resp = api.post(INSTANT, BODY, seed_data['tokens'][role], seed_data['SID_A'])
        assert resp.status_code == 403

    def test_background_generation_is_refused(self, seed_data, api):
        resp = api.post(BACKGROUND, BODY, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400

    def test_defaults_to_the_current_month_without_parameters(self, seed_data, api):
        resp = api.post(INSTANT, {'report_type': 'FINANCE_SUMMARY'}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200
        assert resp.content.startswith(b'%PDF')
