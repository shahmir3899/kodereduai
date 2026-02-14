"""
Phase 11 -- Reports Module Tests (pytest format)
==================================================
Covers: GenerateReport (PDF/XLSX for each type), ReportList,
        permissions, school isolation.

Run:
    cd backend
    pytest tests/test_phase11_reports.py -v
"""

import json
from datetime import date

import pytest

from reports.models import GeneratedReport


# =====================================================================
# LEVEL A: GENERATE REPORTS -- ATTENDANCE
# =====================================================================


@pytest.mark.django_db
@pytest.mark.phase11
class TestAttendanceReports:
    """Generate attendance reports in PDF and XLSX formats."""

    def test_daily_attendance_pdf(self, seed_data, api):
        """A1: Daily attendance report (PDF)."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'format': 'PDF',
            'parameters': {'date': str(date.today())},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_daily_attendance_pdf_has_content_disposition(self, seed_data, api):
        """A1b: Daily attendance PDF has Content-Disposition attachment header."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'format': 'PDF',
            'parameters': {'date': str(date.today())},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert 'attachment' in resp.get('Content-Disposition', ''), \
            f"Content-Disposition missing attachment: {resp.get('Content-Disposition', '')}"

    def test_daily_attendance_with_class_filter(self, seed_data, api):
        """A2: Daily attendance with class filter."""
        class_1 = seed_data['classes'][0]
        resp = api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'format': 'PDF',
            'parameters': {'date': str(date.today()), 'class_id': class_1.id},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_monthly_attendance_pdf(self, seed_data, api):
        """A3: Monthly attendance report (PDF)."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_MONTHLY',
            'format': 'PDF',
            'parameters': {'month': 1, 'year': 2025},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_daily_attendance_xlsx(self, seed_data, api):
        """A4: Daily attendance as XLSX."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'format': 'XLSX',
            'parameters': {'date': str(date.today())},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_daily_attendance_xlsx_content_type(self, seed_data, api):
        """A4b: XLSX response has correct spreadsheet content type."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'format': 'XLSX',
            'parameters': {'date': str(date.today())},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        ct = resp.get('Content-Type', '')
        assert 'spreadsheet' in ct or 'openxml' in ct, \
            f"Expected spreadsheet content type, got: {ct}"

    def test_principal_can_generate_report(self, seed_data, api):
        """A5: Principal can generate attendance report."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'format': 'PDF',
            'parameters': {},
        }, seed_data['tokens']['principal'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"


# =====================================================================
# LEVEL B: GENERATE REPORTS -- FEE
# =====================================================================


@pytest.mark.django_db
@pytest.mark.phase11
class TestFeeReports:
    """Generate fee-related reports in PDF and XLSX formats."""

    def test_fee_collection_pdf(self, seed_data, api):
        """B1: Fee collection summary PDF."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'FEE_COLLECTION',
            'format': 'PDF',
            'parameters': {'month': 1, 'year': 2025},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_fee_defaulters_pdf(self, seed_data, api):
        """B2: Fee defaulters list PDF."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'FEE_DEFAULTERS',
            'format': 'PDF',
            'parameters': {'month': 1, 'year': 2025},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_fee_collection_xlsx(self, seed_data, api):
        """B3: Fee collection as XLSX."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'FEE_COLLECTION',
            'format': 'XLSX',
            'parameters': {'month': 1, 'year': 2025},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"


# =====================================================================
# LEVEL C: GENERATE REPORTS -- ACADEMIC
# =====================================================================


@pytest.mark.django_db
@pytest.mark.phase11
class TestAcademicReports:
    """Generate academic/student reports in PDF and XLSX formats."""

    def test_student_progress_pdf(self, seed_data, api):
        """C1: Student progress report PDF."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/reports/generate/', {
            'report_type': 'STUDENT_PROGRESS',
            'format': 'PDF',
            'parameters': {'student_id': student_1.id},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_student_comprehensive_pdf(self, seed_data, api):
        """C2: Student comprehensive report PDF."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/reports/generate/', {
            'report_type': 'STUDENT_COMPREHENSIVE',
            'format': 'PDF',
            'parameters': {'student_id': student_1.id},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_class_result_pdf_no_exam_data(self, seed_data, api):
        """C3: Class result PDF with nonexistent exam (should handle gracefully)."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'CLASS_RESULT',
            'format': 'PDF',
            'parameters': {'exam_id': 0},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_student_comprehensive_xlsx(self, seed_data, api):
        """C4: Student comprehensive as XLSX."""
        student_1 = seed_data['students'][0]
        resp = api.post('/api/reports/generate/', {
            'report_type': 'STUDENT_COMPREHENSIVE',
            'format': 'XLSX',
            'parameters': {'student_id': student_1.id},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"


# =====================================================================
# LEVEL D: REPORT LIST
# =====================================================================


@pytest.mark.django_db
@pytest.mark.phase11
class TestReportList:
    """List generated reports and verify structure."""

    def _generate_a_report(self, seed_data, api):
        """Helper: generate a report so the list endpoint has data."""
        api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'format': 'PDF',
            'parameters': {'date': str(date.today())},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])

    def test_list_reports_admin(self, seed_data, api):
        """D1: Admin can list generated reports (at least 1)."""
        self._generate_a_report(seed_data, api)
        resp = api.get('/api/reports/list/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert len(data) >= 1, f"Expected at least 1 report, got {len(data)}"

    def test_report_has_correct_fields(self, seed_data, api):
        """D2: Report object contains required fields."""
        self._generate_a_report(seed_data, api)
        resp = api.get('/api/reports/list/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert len(data) >= 1, "No reports returned"
        r = data[0]
        required_keys = ['id', 'report_type', 'format', 'generated_by', 'created_at']
        for key in required_keys:
            assert key in r, f"Missing key '{key}' in report. Keys: {list(r.keys())}"

    def test_teacher_can_list_reports(self, seed_data, api):
        """D3: Teacher can list reports (HasSchoolAccess, not IsSchoolAdmin)."""
        resp = api.get('/api/reports/list/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_reports_ordered_newest_first(self, seed_data, api):
        """D4: Reports are ordered by newest first."""
        # Generate two reports so ordering can be verified
        self._generate_a_report(seed_data, api)
        self._generate_a_report(seed_data, api)
        resp = api.get('/api/reports/list/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        if len(data) >= 2:
            assert data[0]['created_at'] >= data[1]['created_at'], \
                f"Not ordered newest first: {data[0]['created_at']} < {data[1]['created_at']}"


# =====================================================================
# LEVEL E: PERMISSIONS & VALIDATION
# =====================================================================


@pytest.mark.django_db
@pytest.mark.phase11
class TestPermissionsAndValidation:
    """Permissions and input validation for report endpoints."""

    def test_teacher_cannot_generate_reports(self, seed_data, api):
        """E1: Teacher cannot generate reports -> 403."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'format': 'PDF',
            'parameters': {},
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"

    def test_invalid_report_type_returns_400(self, seed_data, api):
        """E2: Invalid report_type -> 400."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'INVALID_TYPE_XYZ',
            'format': 'PDF',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"

    def test_missing_report_type_returns_400(self, seed_data, api):
        """E3: Missing report_type -> 400."""
        resp = api.post('/api/reports/generate/', {
            'format': 'PDF',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"

    def test_generate_without_school_id_returns_400(self, seed_data, api):
        """E4: Generate report without X-School-ID header -> 400."""
        resp = api.client.post(
            '/api/reports/generate/',
            data=json.dumps({
                'report_type': 'ATTENDANCE_DAILY',
                'format': 'PDF',
            }),
            HTTP_AUTHORIZATION=f"Bearer {seed_data['tokens']['admin']}",
            content_type='application/json',
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"

    def test_list_without_school_id_returns_400(self, seed_data, api):
        """E5: List reports without X-School-ID header -> 400."""
        resp = api.client.get(
            '/api/reports/list/',
            HTTP_AUTHORIZATION=f"Bearer {seed_data['tokens']['admin']}",
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"


# =====================================================================
# LEVEL F: CROSS-CUTTING & SECURITY
# =====================================================================


@pytest.mark.django_db
@pytest.mark.phase11
class TestCrossCuttingAndSecurity:
    """Authentication, authorization, and school isolation tests."""

    def test_unauthenticated_returns_401(self, seed_data, api):
        """F1: Unauthenticated request -> 401."""
        resp = api.client.get('/api/reports/list/')
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_invalid_token_returns_401(self, seed_data, api):
        """F2: Invalid token -> 401."""
        resp = api.client.get(
            '/api/reports/list/',
            HTTP_AUTHORIZATION='Bearer garbage_token',
        )
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_school_b_cannot_see_school_a_reports(self, seed_data, api):
        """F3: School B admin cannot see School A reports (isolation)."""
        # First generate a report for School A
        api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'format': 'PDF',
            'parameters': {'date': str(date.today())},
        }, seed_data['tokens']['admin'], seed_data['SID_A'])

        # School B admin lists reports -- should see none from School A
        resp = api.get('/api/reports/list/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        data = resp.json() if resp.status_code == 200 else []
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert len(data) == 0, f"School B should see 0 reports, got {len(data)}"

    def test_school_b_admin_can_generate_own_report(self, seed_data, api):
        """F4: School B admin can generate their own report."""
        resp = api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'format': 'PDF',
            'parameters': {},
        }, seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    def test_school_b_list_has_own_report(self, seed_data, api):
        """F5: After generating, School B list has at least 1 report."""
        # Generate a report for School B
        api.post('/api/reports/generate/', {
            'report_type': 'ATTENDANCE_DAILY',
            'format': 'PDF',
            'parameters': {},
        }, seed_data['tokens']['admin_b'], seed_data['SID_B'])

        # List should include it
        resp = api.get('/api/reports/list/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        data = resp.json() if resp.status_code == 200 else []
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert len(data) >= 1, f"Expected at least 1 report for School B, got {len(data)}"
