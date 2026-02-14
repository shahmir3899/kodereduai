"""
Phase 5: HR & Payroll — Comprehensive API Test Suite (pytest format).

Tests all 11 HR ViewSets (departments, designations, staff, salary structures,
payslips, leave policies, leave applications, staff attendance, appraisals,
qualifications, documents) with role-based access control.

Write access: SCHOOL_ADMIN, PRINCIPAL, HR_MANAGER
Read-only: TEACHER, ACCOUNTANT
"""

import pytest
from hr.models import (
    StaffDepartment, StaffDesignation, StaffMember,
    SalaryStructure, Payslip, LeavePolicy, LeaveApplication,
    StaffAttendance, PerformanceAppraisal, StaffQualification, StaffDocument,
)

P5 = "P5HR_"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_dept_id(school, name):
    obj = StaffDepartment.objects.filter(school=school, name=name).first()
    return obj.id if obj else None


def _get_desig_id(school, name):
    obj = StaffDesignation.objects.filter(school=school, name=name).first()
    return obj.id if obj else None


def _get_staff_id(school, employee_id):
    obj = StaffMember.objects.filter(school=school, employee_id=employee_id).first()
    return obj.id if obj else None


# ==========================================================================
# LEVEL A: DEPARTMENTS API
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestDepartmentsAPI:

    def test_a1_create_department_admin(self, seed_data, api):
        resp = api.post('/api/hr/departments/', {
            'name': f'{P5}Finance Dept',
            'description': 'Finance department',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "A1 Create department (Admin)"

    def test_a2_create_department_hr_manager(self, seed_data, api):
        resp = api.post('/api/hr/departments/', {
            'name': f'{P5}IT Dept',
            'description': 'IT department',
        }, seed_data['tokens']['hr_manager'], seed_data['SID_A'])
        assert resp.status_code == 201, "A2 Create department (HR Manager)"

    def test_a3_create_department_teacher_forbidden(self, seed_data, api):
        resp = api.post('/api/hr/departments/', {
            'name': f'{P5}Illegal Dept',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "A3 Create department (Teacher) -> 403"

    def test_a4_duplicate_name_rejected(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/departments/', {
            'name': f'{P5}Finance Dept',
            'description': 'Finance department',
        }, token, sid)
        resp = api.post('/api/hr/departments/', {
            'name': f'{P5}Finance Dept',
        }, token, sid)
        assert resp.status_code == 400, "A4 Duplicate name -> 400"

    def test_a5_list_departments(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/departments/', {'name': f'{P5}ListDept1'}, token, sid)
        api.post('/api/hr/departments/', {'name': f'{P5}ListDept2'}, token, sid)
        resp = api.get('/api/hr/departments/', token, sid)
        assert resp.status_code == 200, "A5 List departments"
        depts = resp.json()
        test_depts = [d for d in depts if d.get('name', '').startswith(P5)]
        assert len(test_depts) >= 2, "A5 List departments count"

    def test_a6_retrieve_single(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {
            'name': f'{P5}Finance Dept',
            'description': 'Finance department',
        }, token, sid)
        dept_id = _get_dept_id(school_a, f'{P5}Finance Dept')
        assert dept_id is not None, "A6 department must exist"
        resp = api.get(f'/api/hr/departments/{dept_id}/', token, sid)
        assert resp.status_code == 200, "A6 Retrieve single"
        assert resp.json().get('name') == f'{P5}Finance Dept', "A6 Retrieve single name"

    def test_a7_update_department(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {
            'name': f'{P5}Finance Dept',
            'description': 'Finance department',
        }, token, sid)
        dept_id = _get_dept_id(school_a, f'{P5}Finance Dept')
        assert dept_id is not None, "A7 department must exist"
        resp = api.patch(f'/api/hr/departments/{dept_id}/', {
            'description': 'Updated finance dept',
        }, token, sid)
        assert resp.status_code == 200, "A7 Update department"

    def test_a8_soft_delete_department(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {'name': f'{P5}TempDept'}, token, sid)
        temp_id = _get_dept_id(school_a, f'{P5}TempDept')
        assert temp_id is not None, "A8 temp department must exist"
        resp = api.delete(f'/api/hr/departments/{temp_id}/', token, sid)
        assert resp.status_code in (200, 204), "A8 Soft-delete department"
        obj = StaffDepartment.objects.filter(id=temp_id).first()
        assert obj and not obj.is_active, "A8b is_active=False"

    def test_a9_school_b_isolation(self, seed_data, api):
        token_a = seed_data['tokens']['admin']
        sid_a = seed_data['SID_A']
        api.post('/api/hr/departments/', {'name': f'{P5}IsolationDept'}, token_a, sid_a)
        resp = api.get('/api/hr/departments/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        results = resp.json() if resp.status_code == 200 else []
        test_in_b = [d for d in results if d.get('name', '').startswith(P5)]
        assert len(test_in_b) == 0, "A9 School B isolation (empty)"


# ==========================================================================
# LEVEL B: DESIGNATIONS API
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestDesignationsAPI:

    def _setup_dept(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/departments/', {
            'name': f'{P5}Finance Dept',
            'description': 'Finance department',
        }, token, sid)
        return _get_dept_id(seed_data['school_a'], f'{P5}Finance Dept')

    def test_b1_create_designation_admin(self, seed_data, api):
        resp = api.post('/api/hr/designations/', {
            'name': f'{P5}Senior Teacher',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "B1 Create designation (Admin)"

    def test_b2_create_designation_principal(self, seed_data, api):
        resp = api.post('/api/hr/designations/', {
            'name': f'{P5}Lab Assistant',
        }, seed_data['tokens']['principal'], seed_data['SID_A'])
        assert resp.status_code == 201, "B2 Create designation (Principal)"

    def test_b3_create_designation_teacher_forbidden(self, seed_data, api):
        resp = api.post('/api/hr/designations/', {
            'name': f'{P5}Illegal Desig',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "B3 Create designation (Teacher) -> 403"

    def test_b4_duplicate_name_rejected(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/designations/', {'name': f'{P5}Senior Teacher'}, token, sid)
        resp = api.post('/api/hr/designations/', {'name': f'{P5}Senior Teacher'}, token, sid)
        assert resp.status_code == 400, "B4 Duplicate name -> 400"

    def test_b5_create_with_department_fk(self, seed_data, api):
        dept_id = self._setup_dept(seed_data, api)
        resp = api.post('/api/hr/designations/', {
            'name': f'{P5}Finance Officer',
            'department': dept_id,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "B5 Create with department FK"

    def test_b6_list_designations(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/designations/', {'name': f'{P5}DesigList1'}, token, sid)
        api.post('/api/hr/designations/', {'name': f'{P5}DesigList2'}, token, sid)
        api.post('/api/hr/designations/', {'name': f'{P5}DesigList3'}, token, sid)
        resp = api.get('/api/hr/designations/', token, sid)
        assert resp.status_code == 200, "B6 List designations"
        desigs = resp.json()
        test_desigs = [d for d in desigs if d.get('name', '').startswith(P5)]
        assert len(test_desigs) >= 3, "B6 List designations count"

    def test_b7_filter_by_department(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        dept_id = self._setup_dept(seed_data, api)
        assert dept_id is not None, "B7 department must exist"
        api.post('/api/hr/designations/', {
            'name': f'{P5}Finance Officer',
            'department': dept_id,
        }, token, sid)
        resp = api.get(f'/api/hr/designations/?department={dept_id}', token, sid)
        assert resp.status_code == 200, "B7 Filter by department"
        filtered = resp.json()
        test_filtered = [d for d in filtered if d.get('name', '').startswith(P5)]
        assert len(test_filtered) >= 1, "B7 Filter by department count"

    def test_b8_update_designation(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/designations/', {'name': f'{P5}Senior Teacher'}, token, sid)
        desig_id = _get_desig_id(school_a, f'{P5}Senior Teacher')
        assert desig_id is not None, "B8 designation must exist"
        resp = api.patch(f'/api/hr/designations/{desig_id}/', {
            'name': f'{P5}Senior Teacher Updated',
        }, token, sid)
        assert resp.status_code == 200, "B8 Update designation"

    def test_b9_soft_delete_designation(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/designations/', {'name': f'{P5}TempDesig'}, token, sid)
        temp_id = _get_desig_id(school_a, f'{P5}TempDesig')
        assert temp_id is not None, "B9 designation must exist"
        resp = api.delete(f'/api/hr/designations/{temp_id}/', token, sid)
        assert resp.status_code in (200, 204), "B9 Soft-delete designation"

    def test_b10_school_b_isolation(self, seed_data, api):
        token_a = seed_data['tokens']['admin']
        sid_a = seed_data['SID_A']
        api.post('/api/hr/designations/', {'name': f'{P5}IsolDesig'}, token_a, sid_a)
        resp = api.get('/api/hr/designations/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        results = resp.json() if resp.status_code == 200 else []
        test_in_b = [d for d in results if d.get('name', '').startswith(P5)]
        assert len(test_in_b) == 0, "B10 School B isolation (empty)"


# ==========================================================================
# LEVEL C: STAFF MEMBERS API
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestStaffAPI:

    def _setup_depts(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {'name': f'{P5}Finance Dept'}, token, sid)
        api.post('/api/hr/departments/', {'name': f'{P5}IT Dept'}, token, sid)
        return (
            _get_dept_id(school_a, f'{P5}Finance Dept'),
            _get_dept_id(school_a, f'{P5}IT Dept'),
        )

    def _setup_staff(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        dept_fin, dept_it = self._setup_depts(seed_data, api)
        api.post('/api/hr/designations/', {'name': f'{P5}Senior Teacher'}, token, sid)
        desig_sr_id = _get_desig_id(school_a, f'{P5}Senior Teacher')
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Ahmad', 'last_name': 'Raza',
            'employee_id': f'{P5}E001', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2024-06-01',
        }, token, sid)
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Fatima', 'last_name': 'Shah',
            'employee_id': f'{P5}E002', 'department': dept_it,
            'employment_status': 'ACTIVE', 'employment_type': 'PART_TIME',
            'date_of_joining': '2024-09-01',
        }, token, sid)
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Zain', 'last_name': 'Ali',
            'employee_id': f'{P5}E003', 'email': f'{P5}zain@test.com',
            'phone': '03001234567', 'gender': 'MALE',
            'date_of_birth': '1990-01-15', 'department': dept_fin,
            'designation': desig_sr_id,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2023-01-01', 'address': '123 Test Street',
            'emergency_contact_name': 'Parent Name',
            'emergency_contact_phone': '03009876543', 'notes': 'Test staff member',
        }, token, sid)
        return {
            'dept_fin': dept_fin, 'dept_it': dept_it, 'desig_sr_id': desig_sr_id,
            'e001': _get_staff_id(school_a, f'{P5}E001'),
            'e002': _get_staff_id(school_a, f'{P5}E002'),
            'e003': _get_staff_id(school_a, f'{P5}E003'),
        }

    def test_c1_create_staff_admin(self, seed_data, api):
        dept_fin, _ = self._setup_depts(seed_data, api)
        resp = api.post('/api/hr/staff/', {
            'first_name': f'{P5}Ahmad', 'last_name': 'Raza',
            'employee_id': f'{P5}E001', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2024-06-01',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "C1 Create staff member (Admin)"

    def test_c2_create_staff_hr_manager(self, seed_data, api):
        _, dept_it = self._setup_depts(seed_data, api)
        resp = api.post('/api/hr/staff/', {
            'first_name': f'{P5}Fatima', 'last_name': 'Shah',
            'employee_id': f'{P5}E002', 'department': dept_it,
            'employment_status': 'ACTIVE', 'employment_type': 'PART_TIME',
            'date_of_joining': '2024-09-01',
        }, seed_data['tokens']['hr_manager'], seed_data['SID_A'])
        assert resp.status_code == 201, "C2 Create staff member (HR Manager)"

    def test_c3_create_staff_teacher_forbidden(self, seed_data, api):
        resp = api.post('/api/hr/staff/', {
            'first_name': f'{P5}Illegal', 'last_name': 'Staff',
            'employee_id': f'{P5}E999',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "C3 Create staff member (Teacher) -> 403"

    def test_c4_create_with_all_fields(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        dept_fin, _ = self._setup_depts(seed_data, api)
        api.post('/api/hr/designations/', {'name': f'{P5}Senior Teacher'}, token, sid)
        desig_sr_id = _get_desig_id(school_a, f'{P5}Senior Teacher')
        resp = api.post('/api/hr/staff/', {
            'first_name': f'{P5}Zain', 'last_name': 'Ali',
            'employee_id': f'{P5}E003', 'email': f'{P5}zain@test.com',
            'phone': '03001234567', 'gender': 'MALE',
            'date_of_birth': '1990-01-15', 'department': dept_fin,
            'designation': desig_sr_id if desig_sr_id else None,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2023-01-01', 'address': '123 Test Street',
            'emergency_contact_name': 'Parent Name',
            'emergency_contact_phone': '03009876543', 'notes': 'Test staff member',
        }, token, sid)
        assert resp.status_code == 201, "C4 Create with all fields"

    def test_c5_duplicate_employee_id_rejected(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        dept_fin, _ = self._setup_depts(seed_data, api)
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Ahmad', 'last_name': 'Raza',
            'employee_id': f'{P5}E001', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2024-06-01',
        }, token, sid)
        resp = api.post('/api/hr/staff/', {
            'first_name': f'{P5}Dup', 'last_name': 'Test',
            'employee_id': f'{P5}E001',
        }, token, sid)
        assert resp.status_code == 400, "C5 Duplicate employee_id -> 400"

    def test_c6_list_staff_members(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        resp = api.get('/api/hr/staff/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "C6 List staff members"
        staffs = resp.json()
        test_staff = [s for s in staffs if s.get('employee_id', '').startswith(P5)]
        assert len(test_staff) >= 3, "C6 List staff members count"

    def test_c7_search_by_name(self, seed_data, api):
        self._setup_staff(seed_data, api)
        resp = api.get(f'/api/hr/staff/?search={P5}Ahmad', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "C7 Search by name"
        results = resp.json()
        assert len(results) >= 1, "C7 Search by name count"

    def test_c8_filter_by_department(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        dept_fin = ids['dept_fin']
        assert dept_fin is not None, "C8 department must exist"
        resp = api.get(f'/api/hr/staff/?department={dept_fin}', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "C8 Filter by department"
        results = resp.json()
        test_filtered = [s for s in results if s.get('employee_id', '').startswith(P5)]
        assert len(test_filtered) >= 1, "C8 Filter by department count"

    def test_c9_filter_by_employment_status(self, seed_data, api):
        self._setup_staff(seed_data, api)
        resp = api.get('/api/hr/staff/?employment_status=ACTIVE', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "C9 Filter by employment_status"

    def test_c10_filter_by_employment_type(self, seed_data, api):
        self._setup_staff(seed_data, api)
        resp = api.get('/api/hr/staff/?employment_type=PART_TIME', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "C10 Filter by employment_type"
        results = resp.json()
        test_pt = [s for s in results if s.get('employee_id', '').startswith(P5)]
        assert len(test_pt) >= 1, "C10 Filter by employment_type count"

    def test_c11_retrieve_single_staff(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        staff_e003_id = ids['e003']
        assert staff_e003_id is not None, "C11 staff must exist"
        resp = api.get(f'/api/hr/staff/{staff_e003_id}/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "C11 Retrieve single staff"
        data = resp.json()
        assert data.get('email') == f'{P5}zain@test.com', "C11 Retrieve single staff email"

    def test_c12_update_staff_patch(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        staff_e001_id = ids['e001']
        assert staff_e001_id is not None, "C12 staff must exist"
        resp = api.patch(f'/api/hr/staff/{staff_e001_id}/', {
            'phone': '03111111111',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "C12 Update staff (PATCH)"

    def test_c13_soft_delete_staff(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Temp', 'last_name': 'Del',
            'employee_id': f'{P5}EDEL',
        }, token, sid)
        temp_staff_id = _get_staff_id(school_a, f'{P5}EDEL')
        assert temp_staff_id is not None, "C13 staff must exist"
        resp = api.delete(f'/api/hr/staff/{temp_staff_id}/', token, sid)
        assert resp.status_code in (200, 204), "C13 Soft-delete staff"
        obj = StaffMember.objects.filter(id=temp_staff_id).first()
        assert obj and not obj.is_active, "C13b is_active=False"

    def test_c14_dashboard_stats(self, seed_data, api):
        self._setup_staff(seed_data, api)
        resp = api.get('/api/hr/staff/dashboard_stats/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "C14 Dashboard stats"
        data = resp.json()
        assert 'total_staff' in data, "C14 Dashboard stats has total_staff"

    def test_c15_school_b_isolation(self, seed_data, api):
        self._setup_staff(seed_data, api)
        resp = api.get('/api/hr/staff/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        results = resp.json() if resp.status_code == 200 else []
        test_in_b = [s for s in results if s.get('employee_id', '').startswith(P5)]
        assert len(test_in_b) == 0, "C15 School B isolation (empty)"


# ==========================================================================
# LEVEL D: SALARY STRUCTURES API
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestSalaryStructuresAPI:

    def _setup_staff(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {'name': f'{P5}Finance Dept'}, token, sid)
        api.post('/api/hr/departments/', {'name': f'{P5}IT Dept'}, token, sid)
        dept_fin = _get_dept_id(school_a, f'{P5}Finance Dept')
        dept_it = _get_dept_id(school_a, f'{P5}IT Dept')
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Ahmad', 'last_name': 'Raza',
            'employee_id': f'{P5}E001', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2024-06-01',
        }, token, sid)
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Fatima', 'last_name': 'Shah',
            'employee_id': f'{P5}E002', 'department': dept_it,
            'employment_status': 'ACTIVE', 'employment_type': 'PART_TIME',
            'date_of_joining': '2024-09-01',
        }, token, sid)
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Zain', 'last_name': 'Ali',
            'employee_id': f'{P5}E003', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2023-01-01',
        }, token, sid)
        return {
            'e001': _get_staff_id(school_a, f'{P5}E001'),
            'e002': _get_staff_id(school_a, f'{P5}E002'),
            'e003': _get_staff_id(school_a, f'{P5}E003'),
        }

    def test_d1_create_salary_structure_admin(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        assert ids['e001'] is not None, "D1 staff must exist"
        resp = api.post('/api/hr/salary-structures/', {
            'staff_member': ids['e001'],
            'basic_salary': '50000.00',
            'allowances': {'house_rent': 10000, 'transport': 5000},
            'deductions': {'tax': 3000, 'provident_fund': 2000},
            'effective_from': '2024-06-01',
            'is_active': True,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "D1 Create salary structure (Admin)"

    def test_d2_create_with_json_allowances_deductions(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        assert ids['e002'] is not None, "D2 staff must exist"
        resp = api.post('/api/hr/salary-structures/', {
            'staff_member': ids['e002'],
            'basic_salary': '30000.00',
            'allowances': {'transport': 3000},
            'deductions': {'tax': 1500},
            'effective_from': '2024-09-01',
            'is_active': True,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "D2 Create with JSON allowances+deductions"

    def test_d3_create_salary_structure_teacher_forbidden(self, seed_data, api):
        staff_1 = seed_data['staff'][0]
        resp = api.post('/api/hr/salary-structures/', {
            'staff_member': staff_1.id,
            'basic_salary': '25000.00',
            'effective_from': '2024-01-01',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "D3 Create salary structure (Teacher) -> 403"

    def test_d4_list_salary_structures(self, seed_data, api):
        resp = api.get('/api/hr/salary-structures/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "D4 List salary structures"

    def test_d5_filter_by_staff_member(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/salary-structures/', {
            'staff_member': ids['e001'],
            'basic_salary': '50000.00',
            'allowances': {'house_rent': 10000, 'transport': 5000},
            'deductions': {'tax': 3000, 'provident_fund': 2000},
            'effective_from': '2024-06-01',
            'is_active': True,
        }, token, sid)
        resp = api.get(f'/api/hr/salary-structures/?staff_member={ids["e001"]}', token, sid)
        assert resp.status_code == 200, "D5 Filter by staff_member"
        results = resp.json()
        assert len(results) >= 1, "D5 Filter by staff_member count"

    def test_d6_get_current_structure(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/salary-structures/', {
            'staff_member': ids['e001'],
            'basic_salary': '50000.00',
            'allowances': {'house_rent': 10000, 'transport': 5000},
            'deductions': {'tax': 3000, 'provident_fund': 2000},
            'effective_from': '2024-06-01',
            'is_active': True,
        }, token, sid)
        resp = api.get(f'/api/hr/salary-structures/current/?staff_member={ids["e001"]}', token, sid)
        assert resp.status_code == 200, "D6 Get current structure"

    def test_d7_update_structure(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/salary-structures/', {
            'staff_member': ids['e001'],
            'basic_salary': '50000.00',
            'allowances': {'house_rent': 10000, 'transport': 5000},
            'deductions': {'tax': 3000, 'provident_fund': 2000},
            'effective_from': '2024-06-01',
            'is_active': True,
        }, token, sid)
        sal = SalaryStructure.objects.filter(school=school_a, staff_member_id=ids['e001']).first()
        assert sal is not None, "D7 salary structure must exist"
        resp = api.patch(f'/api/hr/salary-structures/{sal.id}/', {
            'basic_salary': '55000.00',
        }, token, sid)
        assert resp.status_code == 200, "D7 Update structure"

    def test_d8_soft_delete_structure(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/salary-structures/', {
            'staff_member': ids['e003'],
            'basic_salary': '20000.00',
            'effective_from': '2024-01-01',
            'is_active': True,
        }, token, sid)
        temp_sal = SalaryStructure.objects.filter(school=school_a, staff_member_id=ids['e003']).first()
        assert temp_sal is not None, "D8 salary structure must exist"
        resp = api.delete(f'/api/hr/salary-structures/{temp_sal.id}/', token, sid)
        assert resp.status_code in (200, 204), "D8 Soft-delete structure"

    def test_d9_computed_fields(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/salary-structures/', {
            'staff_member': ids['e001'],
            'basic_salary': '50000.00',
            'allowances': {'house_rent': 10000, 'transport': 5000},
            'deductions': {'tax': 3000, 'provident_fund': 2000},
            'effective_from': '2024-06-01',
            'is_active': True,
        }, token, sid)
        sal = SalaryStructure.objects.filter(school=school_a, staff_member_id=ids['e001']).first()
        assert sal is not None, "D9 salary structure must exist"
        resp = api.get(f'/api/hr/salary-structures/{sal.id}/', token, sid)
        assert resp.status_code == 200, "D9 Computed fields retrieve"
        data = resp.json()
        gross = float(data.get('gross_salary', 0))
        net = float(data.get('net_salary', 0))
        total_ded = float(data.get('total_deductions', 0))
        basic = float(data.get('basic_salary', 0))
        assert gross > basic and net < gross and total_ded > 0, "D9 Computed fields"

    def test_d10_school_b_isolation(self, seed_data, api):
        resp = api.get('/api/hr/salary-structures/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, "D10 School B isolation status"
        results = resp.json()
        assert len(results) == 0, "D10 School B isolation (empty)"


# ==========================================================================
# LEVEL E: PAYSLIPS API
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestPayslipsAPI:

    def _setup_staff_with_salary(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {'name': f'{P5}Finance Dept'}, token, sid)
        dept_fin = _get_dept_id(school_a, f'{P5}Finance Dept')
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Ahmad', 'last_name': 'Raza',
            'employee_id': f'{P5}E001', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2024-06-01',
        }, token, sid)
        e001 = _get_staff_id(school_a, f'{P5}E001')
        api.post('/api/hr/salary-structures/', {
            'staff_member': e001,
            'basic_salary': '55000.00',
            'allowances': {'house_rent': 10000, 'transport': 5000},
            'deductions': {'tax': 3000, 'provident_fund': 2000},
            'effective_from': '2024-06-01',
            'is_active': True,
        }, token, sid)
        return e001

    def test_e1_create_payslip_admin(self, seed_data, api):
        e001 = self._setup_staff_with_salary(seed_data, api)
        assert e001 is not None, "E1 staff must exist"
        resp = api.post('/api/hr/payslips/', {
            'staff_member': e001,
            'month': 1, 'year': 2026,
            'basic_salary': '55000.00',
            'total_allowances': '15000.00',
            'total_deductions': '5000.00',
            'net_salary': '65000.00',
            'working_days': 22, 'present_days': 20,
            'status': 'DRAFT',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "E1 Create payslip (Admin)"

    def test_e2_create_payslip_teacher_forbidden(self, seed_data, api):
        staff_1 = seed_data['staff'][0]
        resp = api.post('/api/hr/payslips/', {
            'staff_member': staff_1.id,
            'month': 1, 'year': 2026,
            'basic_salary': '25000', 'total_allowances': '0',
            'total_deductions': '0', 'net_salary': '25000',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "E2 Create payslip (Teacher) -> 403"

    def test_e3_duplicate_month_year_staff_rejected(self, seed_data, api):
        e001 = self._setup_staff_with_salary(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/payslips/', {
            'staff_member': e001,
            'month': 1, 'year': 2026,
            'basic_salary': '55000', 'total_allowances': '0',
            'total_deductions': '0', 'net_salary': '55000',
        }, token, sid)
        resp = api.post('/api/hr/payslips/', {
            'staff_member': e001,
            'month': 1, 'year': 2026,
            'basic_salary': '55000', 'total_allowances': '0',
            'total_deductions': '0', 'net_salary': '55000',
        }, token, sid)
        assert resp.status_code == 400, "E3 Duplicate month+year+staff -> 400"

    def test_e4_bulk_generate_payslips(self, seed_data, api):
        self._setup_staff_with_salary(seed_data, api)
        resp = api.post('/api/hr/payslips/generate_payslips/', {
            'month': 2, 'year': 2026,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "E4 Bulk generate payslips"
        data = resp.json()
        assert data.get('created', 0) >= 1, "E4 Bulk generate payslips created"

    def test_e5_bulk_generate_skips_existing(self, seed_data, api):
        self._setup_staff_with_salary(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/payslips/generate_payslips/', {
            'month': 2, 'year': 2026,
        }, token, sid)
        resp = api.post('/api/hr/payslips/generate_payslips/', {
            'month': 2, 'year': 2026,
        }, token, sid)
        assert resp.status_code == 200, "E5 Bulk generate skips existing"
        data = resp.json()
        assert data.get('skipped', 0) >= 1, "E5 Bulk generate skips existing count"

    def test_e6_list_payslips(self, seed_data, api):
        resp = api.get('/api/hr/payslips/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "E6 List payslips"

    def test_e7_filter_by_month_year(self, seed_data, api):
        e001 = self._setup_staff_with_salary(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/payslips/', {
            'staff_member': e001,
            'month': 1, 'year': 2026,
            'basic_salary': '55000.00',
            'total_allowances': '15000.00',
            'total_deductions': '5000.00',
            'net_salary': '65000.00',
            'working_days': 22, 'present_days': 20,
            'status': 'DRAFT',
        }, token, sid)
        resp = api.get('/api/hr/payslips/?month=1&year=2026', token, sid)
        assert resp.status_code == 200, "E7 Filter by month/year"
        results = resp.json()
        assert len(results) >= 1, "E7 Filter by month/year count"

    def test_e8_filter_by_status(self, seed_data, api):
        resp = api.get('/api/hr/payslips/?status=DRAFT', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "E8 Filter by status"

    def test_e9_approve_payslip(self, seed_data, api):
        e001 = self._setup_staff_with_salary(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/payslips/', {
            'staff_member': e001,
            'month': 1, 'year': 2026,
            'basic_salary': '55000.00',
            'total_allowances': '15000.00',
            'total_deductions': '5000.00',
            'net_salary': '65000.00',
            'working_days': 22, 'present_days': 20,
            'status': 'DRAFT',
        }, token, sid)
        payslip = Payslip.objects.filter(school=school_a, staff_member_id=e001, month=1, year=2026).first()
        assert payslip is not None, "E9 payslip must exist"
        resp = api.post(f'/api/hr/payslips/{payslip.id}/approve/', {}, token, sid)
        assert resp.status_code == 200, "E9 Approve payslip"
        payslip.refresh_from_db()
        assert payslip.status == 'APPROVED', "E9b status=APPROVED"

    def test_e10_mark_payslip_paid(self, seed_data, api):
        e001 = self._setup_staff_with_salary(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/payslips/', {
            'staff_member': e001,
            'month': 1, 'year': 2026,
            'basic_salary': '55000.00',
            'total_allowances': '15000.00',
            'total_deductions': '5000.00',
            'net_salary': '65000.00',
            'working_days': 22, 'present_days': 20,
            'status': 'DRAFT',
        }, token, sid)
        payslip = Payslip.objects.filter(school=school_a, staff_member_id=e001, month=1, year=2026).first()
        assert payslip is not None, "E10 payslip must exist"
        api.post(f'/api/hr/payslips/{payslip.id}/approve/', {}, token, sid)
        resp = api.post(f'/api/hr/payslips/{payslip.id}/mark_paid/', {}, token, sid)
        assert resp.status_code == 200, "E10 Mark payslip paid"
        payslip.refresh_from_db()
        assert payslip.status == 'PAID', "E10b status=PAID"

    def test_e11_payroll_summary(self, seed_data, api):
        self._setup_staff_with_salary(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/payslips/generate_payslips/', {
            'month': 2, 'year': 2026,
        }, token, sid)
        resp = api.get('/api/hr/payslips/payroll_summary/?month=2&year=2026', token, sid)
        assert resp.status_code == 200, "E11 Payroll summary"
        data = resp.json()
        assert 'total_payslips' in data, "E11 Payroll summary has total_payslips"

    def test_e12_school_b_isolation(self, seed_data, api):
        resp = api.get('/api/hr/payslips/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, "E12 School B isolation status"
        results = resp.json()
        assert len(results) == 0, "E12 School B isolation (empty)"


# ==========================================================================
# LEVEL F: LEAVE POLICIES API
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestLeavePoliciesAPI:

    def test_f1_create_leave_policy_admin(self, seed_data, api):
        resp = api.post('/api/hr/leave-policies/', {
            'name': f'{P5}Annual Leave',
            'leave_type': 'ANNUAL',
            'days_allowed': 20,
            'carry_forward': True,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "F1 Create leave policy (Admin)"

    def test_f2_create_multiple_types(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        for lt_name, lt_type, days in [('Sick Leave', 'SICK', 10), ('Casual Leave', 'CASUAL', 5)]:
            resp = api.post('/api/hr/leave-policies/', {
                'name': f'{P5}{lt_name}',
                'leave_type': lt_type,
                'days_allowed': days,
            }, token, sid)
        assert resp.status_code == 201, "F2 Create multiple types"

    def test_f3_create_leave_policy_teacher_forbidden(self, seed_data, api):
        resp = api.post('/api/hr/leave-policies/', {
            'name': f'{P5}Illegal Policy',
            'leave_type': 'ANNUAL',
            'days_allowed': 99,
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "F3 Create leave policy (Teacher) -> 403"

    def test_f4_list_policies(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/leave-policies/', {
            'name': f'{P5}Annual Leave', 'leave_type': 'ANNUAL', 'days_allowed': 20,
        }, token, sid)
        api.post('/api/hr/leave-policies/', {
            'name': f'{P5}Sick Leave', 'leave_type': 'SICK', 'days_allowed': 10,
        }, token, sid)
        api.post('/api/hr/leave-policies/', {
            'name': f'{P5}Casual Leave', 'leave_type': 'CASUAL', 'days_allowed': 5,
        }, token, sid)
        resp = api.get('/api/hr/leave-policies/', token, sid)
        assert resp.status_code == 200, "F4 List policies"
        policies = resp.json()
        test_pol = [p for p in policies if p.get('name', '').startswith(P5)]
        assert len(test_pol) >= 3, "F4 List policies count"

    def test_f5_update_policy(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/leave-policies/', {
            'name': f'{P5}Annual Leave', 'leave_type': 'ANNUAL',
            'days_allowed': 20, 'carry_forward': True,
        }, token, sid)
        annual_policy = LeavePolicy.objects.filter(school=school_a, name=f'{P5}Annual Leave').first()
        assert annual_policy is not None, "F5 policy must exist"
        resp = api.patch(f'/api/hr/leave-policies/{annual_policy.id}/', {
            'days_allowed': 25,
        }, token, sid)
        assert resp.status_code == 200, "F5 Update policy"

    def test_f6_soft_delete_policy(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/leave-policies/', {
            'name': f'{P5}TempPolicy', 'leave_type': 'OTHER', 'days_allowed': 1,
        }, token, sid)
        temp_pol = LeavePolicy.objects.filter(school=school_a, name=f'{P5}TempPolicy').first()
        assert temp_pol is not None, "F6 policy must exist"
        resp = api.delete(f'/api/hr/leave-policies/{temp_pol.id}/', token, sid)
        assert resp.status_code in (200, 204), "F6 Soft-delete policy"

    def test_f7_school_b_isolation(self, seed_data, api):
        token_a = seed_data['tokens']['admin']
        sid_a = seed_data['SID_A']
        api.post('/api/hr/leave-policies/', {
            'name': f'{P5}Annual Leave', 'leave_type': 'ANNUAL', 'days_allowed': 20,
        }, token_a, sid_a)
        resp = api.get('/api/hr/leave-policies/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        results = resp.json() if resp.status_code == 200 else []
        test_in_b = [p for p in results if p.get('name', '').startswith(P5)]
        assert len(test_in_b) == 0, "F7 School B isolation (empty)"


# ==========================================================================
# LEVEL G: LEAVE APPLICATIONS API
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestLeaveApplicationsAPI:

    def _setup_leave_env(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {'name': f'{P5}Finance Dept'}, token, sid)
        api.post('/api/hr/departments/', {'name': f'{P5}IT Dept'}, token, sid)
        dept_fin = _get_dept_id(school_a, f'{P5}Finance Dept')
        dept_it = _get_dept_id(school_a, f'{P5}IT Dept')
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Ahmad', 'last_name': 'Raza',
            'employee_id': f'{P5}E001', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2024-06-01',
        }, token, sid)
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Fatima', 'last_name': 'Shah',
            'employee_id': f'{P5}E002', 'department': dept_it,
            'employment_status': 'ACTIVE', 'employment_type': 'PART_TIME',
            'date_of_joining': '2024-09-01',
        }, token, sid)
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Zain', 'last_name': 'Ali',
            'employee_id': f'{P5}E003', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2023-01-01',
        }, token, sid)
        api.post('/api/hr/leave-policies/', {
            'name': f'{P5}Annual Leave', 'leave_type': 'ANNUAL',
            'days_allowed': 20, 'carry_forward': True,
        }, token, sid)
        api.post('/api/hr/leave-policies/', {
            'name': f'{P5}Sick Leave', 'leave_type': 'SICK', 'days_allowed': 10,
        }, token, sid)
        annual = LeavePolicy.objects.filter(school=school_a, name=f'{P5}Annual Leave').first()
        sick = LeavePolicy.objects.filter(school=school_a, name=f'{P5}Sick Leave').first()
        return {
            'e001': _get_staff_id(school_a, f'{P5}E001'),
            'e002': _get_staff_id(school_a, f'{P5}E002'),
            'e003': _get_staff_id(school_a, f'{P5}E003'),
            'annual': annual,
            'sick': sick,
        }

    def test_g1_create_leave_application_admin(self, seed_data, api):
        env = self._setup_leave_env(seed_data, api)
        assert env['e001'] and env['annual'], "G1 prerequisites must exist"
        resp = api.post('/api/hr/leave-applications/', {
            'staff_member': env['e001'],
            'leave_policy': env['annual'].id,
            'start_date': '2026-03-01',
            'end_date': '2026-03-05',
            'reason': 'Family vacation',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "G1 Create leave application (Admin)"

    def test_g2_create_leave_application_teacher_forbidden(self, seed_data, api):
        staff_1 = seed_data['staff'][0]
        resp = api.post('/api/hr/leave-applications/', {
            'staff_member': staff_1.id,
            'start_date': '2026-04-01',
            'end_date': '2026-04-02',
            'reason': 'Test',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "G2 Create leave application (Teacher) -> 403"

    def test_g3_list_applications(self, seed_data, api):
        env = self._setup_leave_env(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/leave-applications/', {
            'staff_member': env['e001'],
            'leave_policy': env['annual'].id,
            'start_date': '2026-03-01',
            'end_date': '2026-03-05',
            'reason': 'Family vacation',
        }, token, sid)
        resp = api.get('/api/hr/leave-applications/', token, sid)
        assert resp.status_code == 200, "G3 List applications"
        apps = resp.json()
        assert len(apps) >= 1, "G3 List applications count"

    def test_g4_filter_by_status(self, seed_data, api):
        resp = api.get('/api/hr/leave-applications/?status=PENDING', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "G4 Filter by status"

    def test_g5_filter_by_staff_member(self, seed_data, api):
        env = self._setup_leave_env(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/leave-applications/', {
            'staff_member': env['e001'],
            'leave_policy': env['annual'].id,
            'start_date': '2026-03-01',
            'end_date': '2026-03-05',
            'reason': 'Family vacation',
        }, token, sid)
        resp = api.get(f'/api/hr/leave-applications/?staff_member={env["e001"]}', token, sid)
        assert resp.status_code == 200, "G5 Filter by staff_member"
        results = resp.json()
        assert len(results) >= 1, "G5 Filter by staff_member count"

    def test_g6_approve_application(self, seed_data, api):
        env = self._setup_leave_env(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/leave-applications/', {
            'staff_member': env['e001'],
            'leave_policy': env['annual'].id,
            'start_date': '2026-03-01',
            'end_date': '2026-03-05',
            'reason': 'Family vacation',
        }, token, sid)
        app1 = LeaveApplication.objects.filter(
            school=school_a, staff_member_id=env['e001'], status='PENDING',
        ).first()
        assert app1 is not None, "G6 pending application must exist"
        resp = api.post(f'/api/hr/leave-applications/{app1.id}/approve/', {
            'admin_remarks': 'Approved for vacation',
        }, token, sid)
        assert resp.status_code == 200, "G6 Approve application"
        app1.refresh_from_db()
        assert app1.status == 'APPROVED', "G6b status=APPROVED"

    def test_g7_reject_application(self, seed_data, api):
        env = self._setup_leave_env(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/leave-applications/', {
            'staff_member': env['e002'],
            'leave_policy': env['sick'].id,
            'start_date': '2026-03-10',
            'end_date': '2026-03-12',
            'reason': 'Medical checkup',
        }, token, sid)
        app2 = LeaveApplication.objects.filter(
            school=school_a, staff_member_id=env['e002'], status='PENDING',
        ).first()
        assert app2 is not None, "G7 pending application must exist"
        resp = api.post(f'/api/hr/leave-applications/{app2.id}/reject/', {
            'admin_remarks': 'Insufficient leave balance',
        }, token, sid)
        assert resp.status_code == 200, "G7 Reject application"
        app2.refresh_from_db()
        assert app2.status == 'REJECTED', "G7b status=REJECTED"

    def test_g8_cancel_application(self, seed_data, api):
        env = self._setup_leave_env(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/leave-applications/', {
            'staff_member': env['e003'],
            'leave_policy': env['annual'].id,
            'start_date': '2026-04-01',
            'end_date': '2026-04-03',
            'reason': 'Personal work',
        }, token, sid)
        app3 = LeaveApplication.objects.filter(
            school=school_a, staff_member_id=env['e003'], status='PENDING',
        ).first()
        assert app3 is not None, "G8 pending application must exist"
        resp = api.post(f'/api/hr/leave-applications/{app3.id}/cancel/', {}, token, sid)
        assert resp.status_code == 200, "G8 Cancel application"

    def test_g9_cannot_approve_non_pending(self, seed_data, api):
        env = self._setup_leave_env(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/leave-applications/', {
            'staff_member': env['e001'],
            'leave_policy': env['annual'].id,
            'start_date': '2026-03-01',
            'end_date': '2026-03-05',
            'reason': 'Family vacation',
        }, token, sid)
        app1 = LeaveApplication.objects.filter(
            school=school_a, staff_member_id=env['e001'], status='PENDING',
        ).first()
        assert app1 is not None, "G9 pending application must exist"
        api.post(f'/api/hr/leave-applications/{app1.id}/approve/', {}, token, sid)
        resp = api.post(f'/api/hr/leave-applications/{app1.id}/approve/', {}, token, sid)
        assert resp.status_code == 400, "G9 Cannot approve non-pending"

    def test_g10_leave_balance(self, seed_data, api):
        env = self._setup_leave_env(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/leave-applications/', {
            'staff_member': env['e001'],
            'leave_policy': env['annual'].id,
            'start_date': '2026-03-01',
            'end_date': '2026-03-05',
            'reason': 'Family vacation',
        }, token, sid)
        resp = api.get(
            f'/api/hr/leave-applications/leave_balance/?staff_member={env["e001"]}',
            token, sid,
        )
        assert resp.status_code == 200, "G10 Leave balance"
        data = resp.json()
        assert isinstance(data, list) and len(data) >= 1, "G10 Leave balance has data"

    def test_g11_school_b_isolation(self, seed_data, api):
        resp = api.get('/api/hr/leave-applications/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, "G11 School B isolation status"
        results = resp.json()
        assert len(results) == 0, "G11 School B isolation (empty)"


# ==========================================================================
# LEVEL H: STAFF ATTENDANCE API
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestStaffAttendanceAPI:

    ATT_DATE = '2026-02-10'
    ATT_DATE2 = '2026-02-11'

    def _setup_staff(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {'name': f'{P5}Finance Dept'}, token, sid)
        dept_fin = _get_dept_id(school_a, f'{P5}Finance Dept')
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Ahmad', 'last_name': 'Raza',
            'employee_id': f'{P5}E001', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2024-06-01',
        }, token, sid)
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Fatima', 'last_name': 'Shah',
            'employee_id': f'{P5}E002', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'PART_TIME',
            'date_of_joining': '2024-09-01',
        }, token, sid)
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Zain', 'last_name': 'Ali',
            'employee_id': f'{P5}E003', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2023-01-01',
        }, token, sid)
        return {
            'e001': _get_staff_id(school_a, f'{P5}E001'),
            'e002': _get_staff_id(school_a, f'{P5}E002'),
            'e003': _get_staff_id(school_a, f'{P5}E003'),
        }

    def test_h1_create_attendance_admin(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        assert ids['e001'] is not None, "H1 staff must exist"
        resp = api.post('/api/hr/attendance/', {
            'staff_member': ids['e001'],
            'date': self.ATT_DATE,
            'status': 'PRESENT',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "H1 Create attendance record (Admin)"

    def test_h2_create_with_check_in_check_out(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        assert ids['e002'] is not None, "H2 staff must exist"
        resp = api.post('/api/hr/attendance/', {
            'staff_member': ids['e002'],
            'date': self.ATT_DATE,
            'status': 'PRESENT',
            'check_in': '08:00:00',
            'check_out': '16:00:00',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "H2 Create with check_in/check_out"

    def test_h3_create_attendance_teacher_forbidden(self, seed_data, api):
        staff_1 = seed_data['staff'][0]
        resp = api.post('/api/hr/attendance/', {
            'staff_member': staff_1.id,
            'date': self.ATT_DATE,
            'status': 'PRESENT',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "H3 Create attendance (Teacher) -> 403"

    def test_h4_duplicate_staff_date_rejected(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/attendance/', {
            'staff_member': ids['e001'],
            'date': self.ATT_DATE,
            'status': 'PRESENT',
        }, token, sid)
        resp = api.post('/api/hr/attendance/', {
            'staff_member': ids['e001'],
            'date': self.ATT_DATE,
            'status': 'ABSENT',
        }, token, sid)
        assert resp.status_code == 400, "H4 Duplicate staff+date -> 400"

    def test_h5_list_attendance(self, seed_data, api):
        resp = api.get('/api/hr/attendance/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "H5 List attendance"

    def test_h6_filter_by_date(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/attendance/', {
            'staff_member': ids['e001'],
            'date': self.ATT_DATE,
            'status': 'PRESENT',
        }, token, sid)
        resp = api.get(f'/api/hr/attendance/?date={self.ATT_DATE}', token, sid)
        assert resp.status_code == 200, "H6 Filter by date"
        results = resp.json()
        assert len(results) >= 1, "H6 Filter by date count"

    def test_h7_filter_by_staff_member(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/attendance/', {
            'staff_member': ids['e001'],
            'date': self.ATT_DATE,
            'status': 'PRESENT',
        }, token, sid)
        resp = api.get(f'/api/hr/attendance/?staff_member={ids["e001"]}', token, sid)
        assert resp.status_code == 200, "H7 Filter by staff_member"
        results = resp.json()
        assert len(results) >= 1, "H7 Filter by staff_member count"

    def test_h8_filter_by_status(self, seed_data, api):
        resp = api.get('/api/hr/attendance/?status=PRESENT', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "H8 Filter by status"

    def test_h9_bulk_mark_attendance(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        assert all([ids['e001'], ids['e002'], ids['e003']]), "H9 all staff must exist"
        resp = api.post('/api/hr/attendance/bulk_mark/', {
            'date': self.ATT_DATE2,
            'records': [
                {'staff_member': ids['e001'], 'status': 'PRESENT', 'check_in': '08:00', 'check_out': '16:00'},
                {'staff_member': ids['e002'], 'status': 'ABSENT'},
                {'staff_member': ids['e003'], 'status': 'LATE', 'check_in': '09:30'},
            ],
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "H9 Bulk mark attendance"
        data = resp.json()
        assert data.get('created', 0) >= 1, "H9 Bulk mark attendance created"

    def test_h10_bulk_mark_updates_existing(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/attendance/bulk_mark/', {
            'date': self.ATT_DATE2,
            'records': [
                {'staff_member': ids['e001'], 'status': 'PRESENT'},
                {'staff_member': ids['e002'], 'status': 'ABSENT'},
            ],
        }, token, sid)
        resp = api.post('/api/hr/attendance/bulk_mark/', {
            'date': self.ATT_DATE2,
            'records': [
                {'staff_member': ids['e001'], 'status': 'LATE'},
                {'staff_member': ids['e002'], 'status': 'PRESENT'},
            ],
        }, token, sid)
        assert resp.status_code == 200, "H10 Bulk mark updates existing"
        data = resp.json()
        assert data.get('updated', 0) >= 1, "H10 Bulk mark updates existing count"

    def test_h11_attendance_summary(self, seed_data, api):
        ids = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/attendance/', {
            'staff_member': ids['e001'],
            'date': self.ATT_DATE,
            'status': 'PRESENT',
        }, token, sid)
        resp = api.get(
            f'/api/hr/attendance/summary/?date_from={self.ATT_DATE}&date_to={self.ATT_DATE2}',
            token, sid,
        )
        assert resp.status_code == 200, "H11 Attendance summary"

    def test_h12_school_b_isolation(self, seed_data, api):
        resp = api.get('/api/hr/attendance/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, "H12 School B isolation status"
        results = resp.json()
        assert len(results) == 0, "H12 School B isolation (empty)"


# ==========================================================================
# LEVEL I: PERFORMANCE APPRAISALS API
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestPerformanceAppraisalsAPI:

    def _setup_staff(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {'name': f'{P5}Finance Dept'}, token, sid)
        dept_fin = _get_dept_id(school_a, f'{P5}Finance Dept')
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Ahmad', 'last_name': 'Raza',
            'employee_id': f'{P5}E001', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2024-06-01',
        }, token, sid)
        return _get_staff_id(school_a, f'{P5}E001')

    def test_i1_create_appraisal_admin(self, seed_data, api):
        e001 = self._setup_staff(seed_data, api)
        assert e001 is not None, "I1 staff must exist"
        resp = api.post('/api/hr/appraisals/', {
            'staff_member': e001,
            'review_period_start': '2025-01-01',
            'review_period_end': '2025-12-31',
            'rating': 4,
            'strengths': 'Good teamwork',
            'areas_for_improvement': 'Time management',
            'goals': 'Complete certification',
            'comments': 'Overall good performance',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "I1 Create appraisal (Admin)"

    def test_i2_create_appraisal_teacher_forbidden(self, seed_data, api):
        staff_1 = seed_data['staff'][0]
        resp = api.post('/api/hr/appraisals/', {
            'staff_member': staff_1.id,
            'review_period_start': '2025-01-01',
            'review_period_end': '2025-06-30',
            'rating': 3,
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "I2 Create appraisal (Teacher) -> 403"

    def test_i3_list_appraisals(self, seed_data, api):
        resp = api.get('/api/hr/appraisals/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "I3 List appraisals"

    def test_i4_filter_by_staff_member(self, seed_data, api):
        e001 = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/appraisals/', {
            'staff_member': e001,
            'review_period_start': '2025-01-01',
            'review_period_end': '2025-12-31',
            'rating': 4,
        }, token, sid)
        resp = api.get(f'/api/hr/appraisals/?staff_member={e001}', token, sid)
        assert resp.status_code == 200, "I4 Filter by staff_member"
        results = resp.json()
        assert len(results) >= 1, "I4 Filter by staff_member count"

    def test_i5_update_appraisal(self, seed_data, api):
        e001 = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/appraisals/', {
            'staff_member': e001,
            'review_period_start': '2025-01-01',
            'review_period_end': '2025-12-31',
            'rating': 4,
        }, token, sid)
        appr = PerformanceAppraisal.objects.filter(school=school_a, staff_member_id=e001).first()
        assert appr is not None, "I5 appraisal must exist"
        resp = api.patch(f'/api/hr/appraisals/{appr.id}/', {
            'rating': 5,
            'comments': 'Excellent performance',
        }, token, sid)
        assert resp.status_code == 200, "I5 Update appraisal"

    def test_i6_school_b_isolation(self, seed_data, api):
        resp = api.get('/api/hr/appraisals/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, "I6 School B isolation status"
        results = resp.json()
        assert len(results) == 0, "I6 School B isolation (empty)"


# ==========================================================================
# LEVEL J: STAFF QUALIFICATIONS API
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestStaffQualificationsAPI:

    def _setup_staff(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {'name': f'{P5}Finance Dept'}, token, sid)
        dept_fin = _get_dept_id(school_a, f'{P5}Finance Dept')
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Ahmad', 'last_name': 'Raza',
            'employee_id': f'{P5}E001', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2024-06-01',
        }, token, sid)
        return _get_staff_id(school_a, f'{P5}E001')

    def test_j1_create_qualification_admin(self, seed_data, api):
        e001 = self._setup_staff(seed_data, api)
        assert e001 is not None, "J1 staff must exist"
        resp = api.post('/api/hr/qualifications/', {
            'staff_member': e001,
            'qualification_type': 'DEGREE',
            'qualification_name': f'{P5}MBA Finance',
            'institution': 'IBA Karachi',
            'year_of_completion': 2020,
            'grade_or_percentage': '3.5 GPA',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "J1 Create qualification (Admin)"

    def test_j2_create_multiple_types(self, seed_data, api):
        e001 = self._setup_staff(seed_data, api)
        assert e001 is not None, "J2 staff must exist"
        resp = api.post('/api/hr/qualifications/', {
            'staff_member': e001,
            'qualification_type': 'CERTIFICATION',
            'qualification_name': f'{P5}PMP Certified',
            'institution': 'PMI',
            'year_of_completion': 2022,
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "J2 Create multiple types"

    def test_j3_create_qualification_teacher_forbidden(self, seed_data, api):
        staff_1 = seed_data['staff'][0]
        resp = api.post('/api/hr/qualifications/', {
            'staff_member': staff_1.id,
            'qualification_type': 'DEGREE',
            'qualification_name': 'Test',
            'institution': 'Test',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "J3 Create qualification (Teacher) -> 403"

    def test_j4_list_qualifications(self, seed_data, api):
        resp = api.get('/api/hr/qualifications/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "J4 List qualifications"

    def test_j5_filter_by_staff_member(self, seed_data, api):
        e001 = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/qualifications/', {
            'staff_member': e001,
            'qualification_type': 'DEGREE',
            'qualification_name': f'{P5}MBA Finance',
            'institution': 'IBA Karachi',
            'year_of_completion': 2020,
        }, token, sid)
        api.post('/api/hr/qualifications/', {
            'staff_member': e001,
            'qualification_type': 'CERTIFICATION',
            'qualification_name': f'{P5}PMP Certified',
            'institution': 'PMI',
            'year_of_completion': 2022,
        }, token, sid)
        resp = api.get(f'/api/hr/qualifications/?staff_member={e001}', token, sid)
        assert resp.status_code == 200, "J5 Filter by staff_member"
        results = resp.json()
        assert len(results) >= 2, "J5 Filter by staff_member count"

    def test_j6_filter_by_type(self, seed_data, api):
        resp = api.get('/api/hr/qualifications/?qualification_type=DEGREE', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "J6 Filter by type"

    def test_j7_update_qualification(self, seed_data, api):
        e001 = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/qualifications/', {
            'staff_member': e001,
            'qualification_type': 'DEGREE',
            'qualification_name': f'{P5}MBA Finance',
            'institution': 'IBA Karachi',
            'year_of_completion': 2020,
            'grade_or_percentage': '3.5 GPA',
        }, token, sid)
        qual = StaffQualification.objects.filter(school=school_a, qualification_name__startswith=P5).first()
        assert qual is not None, "J7 qualification must exist"
        resp = api.patch(f'/api/hr/qualifications/{qual.id}/', {
            'grade_or_percentage': '3.8 GPA',
        }, token, sid)
        assert resp.status_code == 200, "J7 Update qualification"

    def test_j8_school_b_isolation(self, seed_data, api):
        resp = api.get('/api/hr/qualifications/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, "J8 School B isolation status"
        results = resp.json()
        assert len(results) == 0, "J8 School B isolation (empty)"


# ==========================================================================
# LEVEL K: STAFF DOCUMENTS API
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestStaffDocumentsAPI:

    def _setup_staff(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {'name': f'{P5}Finance Dept'}, token, sid)
        dept_fin = _get_dept_id(school_a, f'{P5}Finance Dept')
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Ahmad', 'last_name': 'Raza',
            'employee_id': f'{P5}E001', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2024-06-01',
        }, token, sid)
        return _get_staff_id(school_a, f'{P5}E001')

    def test_k1_create_document_admin(self, seed_data, api):
        e001 = self._setup_staff(seed_data, api)
        assert e001 is not None, "K1 staff must exist"
        resp = api.post('/api/hr/documents/', {
            'staff_member': e001,
            'document_type': 'CONTRACT',
            'title': f'{P5}Employment Contract',
            'file_url': 'https://example.com/contract.pdf',
            'notes': 'Signed copy',
        }, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 201, "K1 Create document (Admin)"

    def test_k2_create_document_teacher_forbidden(self, seed_data, api):
        staff_1 = seed_data['staff'][0]
        resp = api.post('/api/hr/documents/', {
            'staff_member': staff_1.id,
            'document_type': 'OTHER',
            'title': 'Test',
            'file_url': 'https://example.com/test.pdf',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "K2 Create document (Teacher) -> 403"

    def test_k3_list_documents(self, seed_data, api):
        resp = api.get('/api/hr/documents/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "K3 List documents"

    def test_k4_filter_by_staff_member(self, seed_data, api):
        e001 = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/documents/', {
            'staff_member': e001,
            'document_type': 'CONTRACT',
            'title': f'{P5}Employment Contract',
            'file_url': 'https://example.com/contract.pdf',
        }, token, sid)
        resp = api.get(f'/api/hr/documents/?staff_member={e001}', token, sid)
        assert resp.status_code == 200, "K4 Filter by staff_member"
        results = resp.json()
        assert len(results) >= 1, "K4 Filter by staff_member count"

    def test_k5_filter_by_type(self, seed_data, api):
        resp = api.get('/api/hr/documents/?document_type=CONTRACT', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, "K5 Filter by type"

    def test_k6_update_document(self, seed_data, api):
        e001 = self._setup_staff(seed_data, api)
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/documents/', {
            'staff_member': e001,
            'document_type': 'CONTRACT',
            'title': f'{P5}Employment Contract',
            'file_url': 'https://example.com/contract.pdf',
            'notes': 'Signed copy',
        }, token, sid)
        doc = StaffDocument.objects.filter(school=school_a, title__startswith=P5).first()
        assert doc is not None, "K6 document must exist"
        resp = api.patch(f'/api/hr/documents/{doc.id}/', {
            'notes': 'Updated notes',
        }, token, sid)
        assert resp.status_code == 200, "K6 Update document"

    def test_k7_school_b_isolation(self, seed_data, api):
        resp = api.get('/api/hr/documents/', seed_data['tokens']['admin_b'], seed_data['SID_B'])
        assert resp.status_code == 200, "K7 School B isolation status"
        results = resp.json()
        assert len(results) == 0, "K7 School B isolation (empty)"


# ==========================================================================
# LEVEL L: CROSS-CUTTING TESTS
# ==========================================================================

@pytest.mark.phase5
@pytest.mark.django_db
class TestCrossCutting:

    def test_l1_unauthenticated_returns_401(self, seed_data, api):
        resp = api.client.get('/api/hr/staff/')
        assert resp.status_code == 401, "L1 Unauthenticated -> 401"

    def test_l2_invalid_token_returns_401(self, seed_data, api):
        resp = api.client.get(
            '/api/hr/staff/',
            HTTP_AUTHORIZATION='Bearer invalid_garbage_token',
            HTTP_X_SCHOOL_ID=str(seed_data['SID_A']),
        )
        assert resp.status_code == 401, "L2 Invalid token -> 401"

    def test_l3_wrong_school_header_no_data(self, seed_data, api):
        token = seed_data['tokens']['admin']
        sid_a = seed_data['SID_A']
        school_a = seed_data['school_a']
        api.post('/api/hr/departments/', {'name': f'{P5}Finance Dept'}, token, sid_a)
        dept_fin = _get_dept_id(school_a, f'{P5}Finance Dept')
        api.post('/api/hr/staff/', {
            'first_name': f'{P5}Ahmad', 'last_name': 'Raza',
            'employee_id': f'{P5}E001', 'department': dept_fin,
            'employment_status': 'ACTIVE', 'employment_type': 'FULL_TIME',
            'date_of_joining': '2024-06-01',
        }, token, sid_a)
        resp = api.get('/api/hr/staff/', token, seed_data['SID_B'])
        results = resp.json() if resp.status_code == 200 else []
        test_in_wrong = [s for s in results if s.get('employee_id', '').startswith(P5)]
        assert len(test_in_wrong) == 0, "L3 Wrong school header -> no data"

    def test_l4_hr_manager_write_access(self, seed_data, api):
        resp = api.post('/api/hr/departments/', {
            'name': f'{P5}HR Test Dept',
        }, seed_data['tokens']['hr_manager'], seed_data['SID_A'])
        assert resp.status_code == 201, "L4 HR Manager write access"

    def test_l5a_teacher_can_read_departments(self, seed_data, api):
        resp = api.get('/api/hr/departments/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 200, "L5a Teacher can READ departments"

    def test_l5b_teacher_cannot_post_departments(self, seed_data, api):
        resp = api.post('/api/hr/departments/', {
            'name': f'{P5}No',
        }, seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, "L5b Teacher can't POST departments"

    def test_l6_data_integrity(self, seed_data, api):
        prefix = seed_data['prefix']
        orig_dept_count = StaffDepartment.objects.exclude(
            school__name__startswith=prefix,
        ).exclude(name__startswith=P5).count()
        orig_staff_count = StaffMember.objects.exclude(
            school__name__startswith=prefix,
        ).exclude(first_name__startswith=P5).count()

        # Create some test data
        token = seed_data['tokens']['admin']
        sid = seed_data['SID_A']
        api.post('/api/hr/departments/', {'name': f'{P5}IntegrityDept'}, token, sid)

        final_dept_count = StaffDepartment.objects.exclude(
            school__name__startswith=prefix,
        ).exclude(name__startswith=P5).count()
        final_staff_count = StaffMember.objects.exclude(
            school__name__startswith=prefix,
        ).exclude(first_name__startswith=P5).count()
        assert final_dept_count == orig_dept_count, "L6a Original departments untouched"
        assert final_staff_count == orig_staff_count, "L6b Original staff untouched"
