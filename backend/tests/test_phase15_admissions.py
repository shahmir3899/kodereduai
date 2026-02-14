"""
Phase 15 -- Admissions Module Tests (pytest)
=============================================
Covers: AdmissionSession CRUD, AdmissionEnquiry CRUD + stage update + convert,
        Documents, Notes, Analytics, Followups, permissions, school isolation.
"""

import pytest
from datetime import date, timedelta


pytestmark = [pytest.mark.django_db, pytest.mark.phase15]


# ====================================================================
# Helper
# ====================================================================

def _results(resp):
    """Unwrap paginated or plain list responses."""
    data = resp.json() if resp.status_code == 200 else []
    if isinstance(data, dict):
        data = data.get('results', [])
    return data


# ====================================================================
# LEVEL A: ADMISSION SESSIONS CRUD
# ====================================================================

class TestAdmissionSessions:
    """AdmissionSession CRUD, permissions, and school isolation."""

    def test_admin_can_create_session(self, seed_data, api):
        """A1 - Admin can create an admission session."""
        prefix = seed_data['prefix']
        ay = seed_data['academic_year']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.post('/api/admissions/sessions/', {
            'academic_year': ay.id,
            'name': f'{prefix}Session 2025',
            'start_date': str(date.today()),
            'end_date': str(date.today() + timedelta(days=90)),
            'grade_levels_open': [1, 2, 3],
            'is_active': True,
        }, token, sid)

        assert resp.status_code == 201, f"A1 Create session failed: status={resp.status_code}"

    def test_teacher_cannot_create_session(self, seed_data, api):
        """A2 - Teacher cannot create a session (403)."""
        prefix = seed_data['prefix']
        ay = seed_data['academic_year']
        token = seed_data['tokens']['teacher']
        sid = seed_data['SID_A']

        resp = api.post('/api/admissions/sessions/', {
            'academic_year': ay.id,
            'name': f'{prefix}Teacher Session',
            'start_date': str(date.today()),
            'end_date': str(date.today() + timedelta(days=30)),
        }, token, sid)

        assert resp.status_code == 403, f"A2 Teacher create session: status={resp.status_code}"

    def test_list_sessions(self, seed_data, api):
        """A3 - Admin can list sessions (at least one exists)."""
        prefix = seed_data['prefix']
        ay = seed_data['academic_year']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Create a session first
        api.post('/api/admissions/sessions/', {
            'academic_year': ay.id,
            'name': f'{prefix}ListSession',
            'start_date': str(date.today()),
            'end_date': str(date.today() + timedelta(days=90)),
            'grade_levels_open': [1, 2, 3],
            'is_active': True,
        }, token, sid)

        resp = api.get('/api/admissions/sessions/', token, sid)
        data = _results(resp)

        assert resp.status_code == 200, f"A3 List sessions: status={resp.status_code}"
        assert len(data) >= 1, f"A3 List sessions: expected >=1, got {len(data)}"

    def test_active_sessions(self, seed_data, api):
        """A4 - Active sessions endpoint returns 200."""
        prefix = seed_data['prefix']
        ay = seed_data['academic_year']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Ensure at least one active session exists
        api.post('/api/admissions/sessions/', {
            'academic_year': ay.id,
            'name': f'{prefix}ActiveSession',
            'start_date': str(date.today()),
            'end_date': str(date.today() + timedelta(days=90)),
            'is_active': True,
        }, token, sid)

        resp = api.get('/api/admissions/sessions/active/', token, sid)
        assert resp.status_code == 200, f"A4 Active sessions: status={resp.status_code}"

    def test_update_session(self, seed_data, api):
        """A5 - Admin can update a session."""
        prefix = seed_data['prefix']
        ay = seed_data['academic_year']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Create
        resp = api.post('/api/admissions/sessions/', {
            'academic_year': ay.id,
            'name': f'{prefix}UpdateMe',
            'start_date': str(date.today()),
            'end_date': str(date.today() + timedelta(days=90)),
            'grade_levels_open': [1, 2, 3],
            'is_active': True,
        }, token, sid)
        assert resp.status_code == 201, "A5 setup: create session failed"
        session_id = resp.json()['id']

        # Update
        resp = api.patch(f'/api/admissions/sessions/{session_id}/', {
            'name': f'{prefix}UpdateMe (Updated)',
        }, token, sid)
        assert resp.status_code == 200, f"A5 Update session: status={resp.status_code}"

    def test_school_b_isolation_sessions(self, seed_data, api):
        """A6 - School B admin sees no School A sessions."""
        token_b = seed_data['tokens']['admin_b']
        sid_b = seed_data['SID_B']

        resp = api.get('/api/admissions/sessions/', token_b, sid_b)
        data = _results(resp)

        assert resp.status_code == 200, f"A6 School B isolation: status={resp.status_code}"
        assert len(data) == 0, f"A6 School B isolation: expected 0 sessions, got {len(data)}"


# ====================================================================
# LEVEL B: ADMISSION ENQUIRIES CRUD
# ====================================================================

class TestEnquiries:
    """AdmissionEnquiry CRUD, filtering, and permissions."""

    @pytest.fixture
    def session_id(self, seed_data, api):
        """Create an admission session and return its id."""
        prefix = seed_data['prefix']
        ay = seed_data['academic_year']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.post('/api/admissions/sessions/', {
            'academic_year': ay.id,
            'name': f'{prefix}EnqSession',
            'start_date': str(date.today()),
            'end_date': str(date.today() + timedelta(days=90)),
            'grade_levels_open': [1, 2, 3],
            'is_active': True,
        }, token, sid)
        assert resp.status_code == 201
        return resp.json()['id']

    def test_admin_can_create_enquiry(self, seed_data, api, session_id):
        """B1 - Admin can create an enquiry."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.post('/api/admissions/enquiries/', {
            'session': session_id,
            'child_name': f'{prefix}Ali Khan',
            'child_dob': '2018-05-15',
            'child_gender': 'MALE',
            'applying_for_grade_level': '1',
            'parent_name': f'{prefix}Mr. Khan',
            'parent_phone': '03001111111',
            'parent_email': f'{prefix}khan@test.com',
            'source': 'WALK_IN',
            'priority': 'HIGH',
        }, token, sid)

        assert resp.status_code == 201, f"B1 Create enquiry: status={resp.status_code}"

    def test_create_second_enquiry_without_session(self, seed_data, api):
        """B2 - Create enquiry without explicit session."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.post('/api/admissions/enquiries/', {
            'child_name': f'{prefix}Sara Ahmed',
            'child_dob': '2019-03-10',
            'child_gender': 'FEMALE',
            'applying_for_grade_level': '1',
            'parent_name': f'{prefix}Mrs. Ahmed',
            'parent_phone': '03002222222',
            'source': 'PHONE',
            'priority': 'MEDIUM',
        }, token, sid)

        assert resp.status_code == 201, f"B2 Create second enquiry: status={resp.status_code}"

    def test_list_enquiries(self, seed_data, api, session_id):
        """B3 - Listing enquiries returns at least 2."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Create two enquiries
        for name, phone in [('ChildA', '03011111111'), ('ChildB', '03022222222')]:
            api.post('/api/admissions/enquiries/', {
                'session': session_id,
                'child_name': f'{prefix}{name}',
                'parent_name': f'{prefix}Parent',
                'parent_phone': phone,
            }, token, sid)

        resp = api.get('/api/admissions/enquiries/', token, sid)
        data = _results(resp)

        assert resp.status_code == 200, f"B3 List enquiries: status={resp.status_code}"
        assert len(data) >= 2, f"B3 List enquiries: expected >=2, got {len(data)}"

    def test_retrieve_enquiry_detail(self, seed_data, api, session_id):
        """B4 - Retrieve single enquiry by id."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.post('/api/admissions/enquiries/', {
            'session': session_id,
            'child_name': f'{prefix}Detail Child',
            'parent_name': f'{prefix}Detail Parent',
            'parent_phone': '03033333333',
        }, token, sid)
        assert resp.status_code == 201
        enq_id = resp.json()['id']

        resp = api.get(f'/api/admissions/enquiries/{enq_id}/', token, sid)
        assert resp.status_code == 200, f"B4 Retrieve enquiry: status={resp.status_code}"

    def test_filter_by_stage(self, seed_data, api, session_id):
        """B5 - Filter enquiries by stage=NEW."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Ensure at least one enquiry exists
        api.post('/api/admissions/enquiries/', {
            'session': session_id,
            'child_name': f'{prefix}StageFilter',
            'parent_name': f'{prefix}Parent',
            'parent_phone': '03044444444',
        }, token, sid)

        resp = api.get('/api/admissions/enquiries/?stage=NEW', token, sid)
        assert resp.status_code == 200, f"B5 Filter by stage: status={resp.status_code}"

    def test_filter_by_source(self, seed_data, api, session_id):
        """B6 - Filter enquiries by source=WALK_IN."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        api.post('/api/admissions/enquiries/', {
            'session': session_id,
            'child_name': f'{prefix}SourceFilter',
            'parent_name': f'{prefix}Parent',
            'parent_phone': '03055555555',
            'source': 'WALK_IN',
        }, token, sid)

        resp = api.get('/api/admissions/enquiries/?source=WALK_IN', token, sid)
        assert resp.status_code == 200, f"B6 Filter by source: status={resp.status_code}"

    def test_teacher_can_read_enquiries(self, seed_data, api):
        """B7 - Teacher CAN read enquiries (200)."""
        token = seed_data['tokens']['teacher']
        sid = seed_data['SID_A']

        resp = api.get('/api/admissions/enquiries/', token, sid)
        assert resp.status_code == 200, f"B7 Teacher read enquiries: status={resp.status_code}"

    def test_teacher_cannot_create_enquiry(self, seed_data, api):
        """B8 - Teacher cannot create enquiry (403)."""
        prefix = seed_data['prefix']
        token = seed_data['tokens']['teacher']
        sid = seed_data['SID_A']

        resp = api.post('/api/admissions/enquiries/', {
            'child_name': f'{prefix}Teacher Child',
            'parent_name': 'Teacher Parent',
            'parent_phone': '03009999999',
        }, token, sid)

        assert resp.status_code == 403, f"B8 Teacher create enquiry: status={resp.status_code}"

    def test_school_b_isolation_enquiries(self, seed_data, api):
        """B9 - School B admin sees no School A enquiries."""
        token_b = seed_data['tokens']['admin_b']
        sid_b = seed_data['SID_B']

        resp = api.get('/api/admissions/enquiries/', token_b, sid_b)
        data = _results(resp)

        assert resp.status_code == 200, f"B9 School B isolation: status={resp.status_code}"
        assert len(data) == 0, f"B9 School B isolation: expected 0, got {len(data)}"


# ====================================================================
# LEVEL C: STAGE UPDATE + CONVERT
# ====================================================================

class TestConversion:
    """Enquiry stage transitions and conversion to student."""

    @pytest.fixture
    def enquiry_ids(self, seed_data, api):
        """Create a session and two enquiries; return (session_id, enq_id, enq2_id)."""
        prefix = seed_data['prefix']
        ay = seed_data['academic_year']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Session
        resp = api.post('/api/admissions/sessions/', {
            'academic_year': ay.id,
            'name': f'{prefix}ConvertSession',
            'start_date': str(date.today()),
            'end_date': str(date.today() + timedelta(days=90)),
            'grade_levels_open': [1, 2, 3],
            'is_active': True,
        }, token, sid)
        assert resp.status_code == 201
        session_id = resp.json()['id']

        # Enquiry 1
        resp = api.post('/api/admissions/enquiries/', {
            'session': session_id,
            'child_name': f'{prefix}StageChild',
            'child_dob': '2018-05-15',
            'child_gender': 'MALE',
            'applying_for_grade_level': '1',
            'parent_name': f'{prefix}StageParent',
            'parent_phone': '03061111111',
            'source': 'WALK_IN',
            'priority': 'HIGH',
        }, token, sid)
        assert resp.status_code == 201
        enq_id = resp.json()['id']

        # Enquiry 2 (will be converted)
        resp = api.post('/api/admissions/enquiries/', {
            'session': session_id,
            'child_name': f'{prefix}ConvertChild',
            'child_dob': '2019-03-10',
            'child_gender': 'FEMALE',
            'applying_for_grade_level': '1',
            'parent_name': f'{prefix}ConvertParent',
            'parent_phone': '03062222222',
            'source': 'PHONE',
            'priority': 'MEDIUM',
        }, token, sid)
        assert resp.status_code == 201
        enq2_id = resp.json()['id']

        return session_id, enq_id, enq2_id

    def test_update_stage_to_contacted(self, seed_data, api, enquiry_ids):
        """C1 - Update enquiry stage to CONTACTED."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        _, enq_id, _ = enquiry_ids

        resp = api.patch(f'/api/admissions/enquiries/{enq_id}/update-stage/', {
            'stage': 'CONTACTED',
            'note': 'Called parent, scheduled visit',
        }, token, sid)

        assert resp.status_code == 200, f"C1 Update stage CONTACTED: status={resp.status_code}"

    def test_update_stage_to_form_submitted(self, seed_data, api, enquiry_ids):
        """C2 - Update enquiry stage to FORM_SUBMITTED."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        _, enq_id, _ = enquiry_ids

        # Move through CONTACTED first
        api.patch(f'/api/admissions/enquiries/{enq_id}/update-stage/', {
            'stage': 'CONTACTED',
        }, token, sid)

        resp = api.patch(f'/api/admissions/enquiries/{enq_id}/update-stage/', {
            'stage': 'FORM_SUBMITTED',
        }, token, sid)

        assert resp.status_code == 200, f"C2 Update stage FORM_SUBMITTED: status={resp.status_code}"

    def test_convert_enquiry_to_student(self, seed_data, api, enquiry_ids):
        """C3 - Convert accepted enquiry into a student record."""
        from admissions.models import AdmissionEnquiry

        prefix = seed_data['prefix']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        class_1 = seed_data['classes'][0]
        _, _, enq2_id = enquiry_ids

        # Move to ACCEPTED stage first
        api.patch(f'/api/admissions/enquiries/{enq2_id}/update-stage/', {
            'stage': 'ACCEPTED',
        }, token, sid)

        resp = api.post(f'/api/admissions/enquiries/{enq2_id}/convert/', {
            'class_id': class_1.id,
            'roll_number': f'{prefix}99',
        }, token, sid)

        assert resp.status_code in (200, 201), \
            f"C3 Convert enquiry: status={resp.status_code}"

        # C3b - Verify stage became ENROLLED
        enq_obj = AdmissionEnquiry.objects.filter(id=enq2_id).first()
        assert enq_obj is not None, "C3b Enquiry not found after conversion"
        assert enq_obj.stage == 'ENROLLED', \
            f"C3b Enquiry stage is {enq_obj.stage}, expected ENROLLED"

        # Cleanup converted student
        from students.models import Student
        Student.objects.filter(school=seed_data['school_a'], roll_number=f'{prefix}99').delete()


# ====================================================================
# LEVEL D: DOCUMENTS & NOTES
# ====================================================================

class TestDocumentsAndNotes:
    """AdmissionDocument and AdmissionNote CRUD for an enquiry."""

    @pytest.fixture
    def enq_id(self, seed_data, api):
        """Create a session + enquiry and return the enquiry id."""
        prefix = seed_data['prefix']
        ay = seed_data['academic_year']
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.post('/api/admissions/sessions/', {
            'academic_year': ay.id,
            'name': f'{prefix}DocNoteSession',
            'start_date': str(date.today()),
            'end_date': str(date.today() + timedelta(days=90)),
            'is_active': True,
        }, token, sid)
        assert resp.status_code == 201
        session_id = resp.json()['id']

        resp = api.post('/api/admissions/enquiries/', {
            'session': session_id,
            'child_name': f'{prefix}DocChild',
            'parent_name': f'{prefix}DocParent',
            'parent_phone': '03071111111',
        }, token, sid)
        assert resp.status_code == 201
        return resp.json()['id']

    def test_add_document(self, seed_data, api, enq_id):
        """D1 - Add a document to an enquiry."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.post(f'/api/admissions/enquiries/{enq_id}/documents/', {
            'enquiry': enq_id,
            'document_type': 'BIRTH_CERT',
            'file_url': 'https://example.com/birth_cert.pdf',
            'file_name': 'birth_certificate.pdf',
        }, token, sid)

        assert resp.status_code == 201, f"D1 Add document: status={resp.status_code}"

    def test_list_documents(self, seed_data, api, enq_id):
        """D2 - List documents for an enquiry (at least 1)."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Add a document first
        api.post(f'/api/admissions/enquiries/{enq_id}/documents/', {
            'enquiry': enq_id,
            'document_type': 'BIRTH_CERT',
            'file_url': 'https://example.com/birth_cert.pdf',
            'file_name': 'birth_certificate.pdf',
        }, token, sid)

        resp = api.get(f'/api/admissions/enquiries/{enq_id}/documents/', token, sid)
        data = _results(resp)

        assert resp.status_code == 200, f"D2 List documents: status={resp.status_code}"
        assert len(data) >= 1, f"D2 List documents: expected >=1, got {len(data)}"

    def test_add_note(self, seed_data, api, enq_id):
        """D3 - Add a note to an enquiry."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.post(f'/api/admissions/enquiries/{enq_id}/notes/', {
            'enquiry': enq_id,
            'note': 'Parent seemed interested in admission',
            'note_type': 'NOTE',
        }, token, sid)

        assert resp.status_code == 201, f"D3 Add note: status={resp.status_code}"

    def test_list_notes(self, seed_data, api, enq_id):
        """D4 - List notes for an enquiry (at least 1)."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        # Add a note first
        api.post(f'/api/admissions/enquiries/{enq_id}/notes/', {
            'enquiry': enq_id,
            'note': 'Parent seemed interested in admission',
            'note_type': 'NOTE',
        }, token, sid)

        resp = api.get(f'/api/admissions/enquiries/{enq_id}/notes/', token, sid)
        data = _results(resp)

        assert resp.status_code == 200, f"D4 List notes: status={resp.status_code}"
        assert len(data) >= 1, f"D4 List notes: expected >=1, got {len(data)}"


# ====================================================================
# LEVEL E: ANALYTICS & FOLLOWUPS
# ====================================================================

class TestAnalyticsAndFollowups:
    """Pipeline analytics and follow-up endpoints."""

    def test_pipeline_analytics(self, seed_data, api):
        """E1 - Pipeline analytics endpoint returns 200."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.get('/api/admissions/analytics/pipeline/', token, sid)
        assert resp.status_code == 200, f"E1 Pipeline analytics: status={resp.status_code}"

    def test_analytics_has_expected_fields(self, seed_data, api):
        """E2 - Analytics response contains total_enquiries and pipeline_funnel."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.get('/api/admissions/analytics/pipeline/', token, sid)
        assert resp.status_code == 200, "E2 Analytics request failed"

        analytics = resp.json()
        assert 'total_enquiries' in analytics, \
            f"E2 Missing 'total_enquiries', keys={list(analytics.keys())}"
        assert 'pipeline_funnel' in analytics, \
            f"E2 Missing 'pipeline_funnel', keys={list(analytics.keys())}"

    def test_todays_followups(self, seed_data, api):
        """E3 - Today's followups endpoint returns 200."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.get('/api/admissions/followups/today/', token, sid)
        assert resp.status_code == 200, f"E3 Today's followups: status={resp.status_code}"

    def test_overdue_followups(self, seed_data, api):
        """E4 - Overdue followups endpoint returns 200."""
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']

        resp = api.get('/api/admissions/followups/overdue/', token, sid)
        assert resp.status_code == 200, f"E4 Overdue followups: status={resp.status_code}"

    def test_teacher_cannot_access_analytics(self, seed_data, api):
        """E5 - Teacher cannot access analytics (403)."""
        token = seed_data['tokens']['teacher']
        sid = seed_data['SID_A']

        resp = api.get('/api/admissions/analytics/pipeline/', token, sid)
        assert resp.status_code == 403, f"E5 Teacher analytics: status={resp.status_code}"


# ====================================================================
# LEVEL F: PERMISSIONS & CROSS-CUTTING
# ====================================================================

class TestPermissions:
    """Authentication, authorization, and cross-cutting concerns."""

    def test_unauthenticated_returns_401(self, seed_data, api):
        """F1 - Unauthenticated request returns 401."""
        resp = api.client.get('/api/admissions/enquiries/')
        assert resp.status_code == 401, f"F1 Unauthenticated: status={resp.status_code}"

    def test_invalid_token_returns_401(self, seed_data, api):
        """F2 - Invalid bearer token returns 401."""
        resp = api.client.get(
            '/api/admissions/enquiries/',
            HTTP_AUTHORIZATION='Bearer garbage_token',
        )
        assert resp.status_code == 401, f"F2 Invalid token: status={resp.status_code}"

    def test_teacher_cannot_update_enquiry(self, seed_data, api):
        """F3 - Teacher cannot update an enquiry (403)."""
        prefix = seed_data['prefix']
        ay = seed_data['academic_year']
        token_admin = seed_data['tokens']['admin']
        token_teacher = seed_data['tokens']['teacher']
        sid = seed_data['SID_A']

        # Create session + enquiry as admin
        resp = api.post('/api/admissions/sessions/', {
            'academic_year': ay.id,
            'name': f'{prefix}PermSession',
            'start_date': str(date.today()),
            'end_date': str(date.today() + timedelta(days=90)),
            'is_active': True,
        }, token_admin, sid)
        assert resp.status_code == 201
        session_id = resp.json()['id']

        resp = api.post('/api/admissions/enquiries/', {
            'session': session_id,
            'child_name': f'{prefix}PermChild',
            'parent_name': f'{prefix}PermParent',
            'parent_phone': '03081111111',
        }, token_admin, sid)
        assert resp.status_code == 201
        enq_id = resp.json()['id']

        # Teacher tries to update
        resp = api.patch(f'/api/admissions/enquiries/{enq_id}/', {
            'priority': 'LOW',
        }, token_teacher, sid)

        assert resp.status_code == 403, f"F3 Teacher update enquiry: status={resp.status_code}"

    def test_teacher_cannot_delete_session(self, seed_data, api):
        """F4 - Teacher cannot delete a session (403)."""
        prefix = seed_data['prefix']
        ay = seed_data['academic_year']
        token_admin = seed_data['tokens']['admin']
        token_teacher = seed_data['tokens']['teacher']
        sid = seed_data['SID_A']

        resp = api.post('/api/admissions/sessions/', {
            'academic_year': ay.id,
            'name': f'{prefix}DelSession',
            'start_date': str(date.today()),
            'end_date': str(date.today() + timedelta(days=90)),
            'is_active': True,
        }, token_admin, sid)
        assert resp.status_code == 201
        session_id = resp.json()['id']

        resp = api.delete(f'/api/admissions/sessions/{session_id}/', token_teacher, sid)
        assert resp.status_code == 403, f"F4 Teacher delete session: status={resp.status_code}"
