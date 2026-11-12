"""Stored reports (the list and the download) are for admin and principal only: a stored student report
can hold a whole record, and the old gate let any signed-in member of the school fetch one by id.
Uses the shared seed school; the row made here is rolled back with the test."""
import pytest

from reports.models import GeneratedReport


def _get(api, seed_data, role, url):
    return api.get(url, seed_data['tokens'][role], seed_data['SID_A'])


@pytest.mark.django_db
@pytest.mark.parametrize('role,allowed', [('admin', True), ('principal', True), ('teacher', False), ('manager', False), ('accountant', False), ('staff', False)])
def test_the_list_is_for_admin_and_principal_only(api, seed_data, role, allowed):
    resp = _get(api, seed_data, role, '/api/reports/list/')
    assert (resp.status_code == 200) is allowed, (role, resp.status_code)
    if not allowed:
        assert resp.status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize('role,status', [('admin', 200), ('principal', 200), ('teacher', 403), ('staff', 403)])
def test_the_download_is_for_admin_and_principal_only(api, seed_data, role, status):
    report = GeneratedReport.objects.create(
        school_id=seed_data['SID_A'], report_type='STUDENT_COMPREHENSIVE', title='Test report', format='PDF', file_content=b'%PDF-1.4 test',
    )
    resp = _get(api, seed_data, role, f'/api/reports/{report.id}/download/')
    assert resp.status_code == status, (role, resp.status_code)
    if status == 200:
        assert resp['Content-Type'] == 'application/pdf'
