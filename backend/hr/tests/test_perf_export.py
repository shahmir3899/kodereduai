"""PDF / Excel export: admins and principals only, both files build."""
import io

import pytest
from openpyxl import load_workbook

pytestmark = pytest.mark.django_db

URL = '/api/hr/teacher-performance/export/'
RANGE = {'start': '2025-11-03', 'end': '2025-11-08'}


@pytest.mark.parametrize('fmt, magic', [('PDF', b'%PDF'), ('XLSX', b'PK')])
def test_admin_downloads_both_formats(perf, api, fmt, magic):
    resp = api.post(URL, {**RANGE, 'format': fmt}, perf['tokens']['admin'], perf['SID_A'])
    assert resp.status_code == 200, resp.content[:200]
    assert resp.content[:len(magic)] == magic
    assert 'teacher-performance-2025-11-03-to-2025-11-08' in resp['Content-Disposition']


def test_excel_lists_every_teacher(perf, api):
    resp = api.post(URL, {**RANGE, 'format': 'XLSX'}, perf['tokens']['principal'], perf['SID_A'])
    assert resp.status_code == 200
    ws = load_workbook(io.BytesIO(resp.content)).active
    text = ' '.join(str(c.value) for row in ws.iter_rows() for c in row if c.value is not None)
    for s in perf['staff']:
        assert s.first_name in text
    assert 'Taught on schedule' in text and 'Leave days' in text  # information columns, Excel only


@pytest.mark.parametrize('who', ['teacher', 'manager', 'staff'])
def test_other_roles_cannot_export(perf, api, who):
    assert api.post(URL, {**RANGE, 'format': 'PDF'}, perf['tokens'][who], perf['SID_A']).status_code == 403


def test_bad_format_is_refused(perf, api):
    assert api.post(URL, {**RANGE, 'format': 'DOCX'}, perf['tokens']['admin'], perf['SID_A']).status_code == 400
