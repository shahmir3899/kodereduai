"""
Phase 5: HR & Payroll — Comprehensive API Test Suite.

Tests all 11 HR ViewSets (departments, designations, staff, salary structures,
payslips, leave policies, leave applications, staff attendance, appraisals,
qualifications, documents) with role-based access control.

Write access: SCHOOL_ADMIN, PRINCIPAL, HR_MANAGER
Read-only: TEACHER, ACCOUNTANT

Run:
    cd backend
    python manage.py shell -c "exec(open('test_phase5_hr.py', encoding='utf-8').read())"
"""

import traceback
from datetime import date, timedelta

# Load shared seed data (auto-creates if missing)
exec(open('seed_test_data.py', encoding='utf-8').read())

from hr.models import (
    StaffDepartment, StaffDesignation, StaffMember,
    SalaryStructure, Payslip, LeavePolicy, LeaveApplication,
    StaffAttendance, PerformanceAppraisal, StaffQualification, StaffDocument,
)

# Phase-specific prefix for objects created by THIS test
P5 = "P5HR_"

try:
    seed = get_seed_data()

    school_a = seed['school_a']
    school_b = seed['school_b']
    SID_A = seed['SID_A']
    SID_B = seed['SID_B']
    token_admin = seed['tokens']['admin']
    token_principal = seed['tokens']['principal']
    token_hr = seed['tokens']['hr_manager']
    token_teacher = seed['tokens']['teacher']
    token_admin_b = seed['tokens']['admin_b']
    staff_1, staff_2, staff_3 = seed['staff'][:3]
    seed_dept_academic = seed['departments'][0]

    # Reset counters
    reset_counters()

    # Snapshot existing data for integrity checks
    orig_dept_count = StaffDepartment.objects.exclude(school__name__startswith=SEED_PREFIX).exclude(name__startswith=P5).count()
    orig_staff_count = StaffMember.objects.exclude(school__name__startswith=SEED_PREFIX).exclude(first_name__startswith=P5).count()

    # ==================================================================
    print("=" * 70)
    print("  PHASE 5 COMPREHENSIVE TEST SUITE — HR & PAYROLL")
    print("=" * 70)

    # ── Helper: DB lookup (create serializers don't return id) ──
    def get_dept_id(name):
        obj = StaffDepartment.objects.filter(school=school_a, name=name).first()
        return obj.id if obj else None

    def get_desig_id(name):
        obj = StaffDesignation.objects.filter(school=school_a, name=name).first()
        return obj.id if obj else None

    def get_staff_id(employee_id):
        obj = StaffMember.objects.filter(school=school_a, employee_id=employee_id).first()
        return obj.id if obj else None

    # ==================================================================
    # LEVEL A: DEPARTMENTS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL A: DEPARTMENTS API")
    print("=" * 70)

    # A1: Create department (Admin)
    resp = api_post('/api/hr/departments/', {
        'name': f'{P5}Finance Dept',
        'description': 'Finance department',
    }, token_admin, SID_A)
    check("A1  Create department (Admin)", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    dept_finance_id = get_dept_id(f'{P5}Finance Dept')

    # A2: Create department (HR Manager)
    resp = api_post('/api/hr/departments/', {
        'name': f'{P5}IT Dept',
        'description': 'IT department',
    }, token_hr, SID_A)
    check("A2  Create department (HR Manager)", resp.status_code == 201,
          f"status={resp.status_code}")
    dept_it_id = get_dept_id(f'{P5}IT Dept')

    # A3: Create department (Teacher) -> 403
    resp = api_post('/api/hr/departments/', {
        'name': f'{P5}Illegal Dept',
    }, token_teacher, SID_A)
    check("A3  Create department (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # A4: Duplicate name -> 400
    resp = api_post('/api/hr/departments/', {
        'name': f'{P5}Finance Dept',
    }, token_admin, SID_A)
    check("A4  Duplicate name -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # A5: List departments
    resp = api_get('/api/hr/departments/', token_admin, SID_A)
    depts = resp.json() if resp.status_code == 200 else []
    test_depts = [d for d in depts if d.get('name', '').startswith(P5)]
    check("A5  List departments", resp.status_code == 200 and len(test_depts) >= 2,
          f"status={resp.status_code} count={len(test_depts)}")

    # A6: Retrieve single
    if dept_finance_id:
        resp = api_get(f'/api/hr/departments/{dept_finance_id}/', token_admin, SID_A)
        check("A6  Retrieve single", resp.status_code == 200 and resp.json().get('name') == f'{P5}Finance Dept',
              f"status={resp.status_code}")
    else:
        check("A6  Retrieve single", False, "no id")

    # A7: Update department
    if dept_finance_id:
        resp = api_patch(f'/api/hr/departments/{dept_finance_id}/', {
            'description': 'Updated finance dept',
        }, token_admin, SID_A)
        check("A7  Update department", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("A7  Update department", False, "no id")

    # A8: Soft-delete department
    # Create a temp one to delete
    api_post('/api/hr/departments/', {'name': f'{P5}TempDept'}, token_admin, SID_A)
    temp_id = get_dept_id(f'{P5}TempDept')
    if temp_id:
        resp = api_delete(f'/api/hr/departments/{temp_id}/', token_admin, SID_A)
        check("A8  Soft-delete department", resp.status_code in (200, 204),
              f"status={resp.status_code}")
        obj = StaffDepartment.objects.filter(id=temp_id).first()
        check("A8b is_active=False", obj and not obj.is_active, "")
    else:
        check("A8  Soft-delete department", False, "no id")
        check("A8b is_active=False", False, "no id")

    # A9: School B isolation
    resp = api_get('/api/hr/departments/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    test_in_b = [d for d in results if d.get('name', '').startswith(P5)]
    check("A9  School B isolation (empty)", len(test_in_b) == 0,
          f"count={len(test_in_b)}")

    # ==================================================================
    # LEVEL B: DESIGNATIONS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL B: DESIGNATIONS API")
    print("=" * 70)

    # B1: Create designation (Admin)
    resp = api_post('/api/hr/designations/', {
        'name': f'{P5}Senior Teacher',
    }, token_admin, SID_A)
    check("B1  Create designation (Admin)", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    desig_sr_id = get_desig_id(f'{P5}Senior Teacher')

    # B2: Create designation (Principal)
    resp = api_post('/api/hr/designations/', {
        'name': f'{P5}Lab Assistant',
    }, token_principal, SID_A)
    check("B2  Create designation (Principal)", resp.status_code == 201,
          f"status={resp.status_code}")
    desig_lab_id = get_desig_id(f'{P5}Lab Assistant')

    # B3: Create designation (Teacher) -> 403
    resp = api_post('/api/hr/designations/', {
        'name': f'{P5}Illegal Desig',
    }, token_teacher, SID_A)
    check("B3  Create designation (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # B4: Duplicate name -> 400
    resp = api_post('/api/hr/designations/', {
        'name': f'{P5}Senior Teacher',
    }, token_admin, SID_A)
    check("B4  Duplicate name -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # B5: Create with department FK
    resp = api_post('/api/hr/designations/', {
        'name': f'{P5}Finance Officer',
        'department': dept_finance_id,
    }, token_admin, SID_A)
    check("B5  Create with department FK", resp.status_code == 201,
          f"status={resp.status_code}")

    # B6: List designations
    resp = api_get('/api/hr/designations/', token_admin, SID_A)
    desigs = resp.json() if resp.status_code == 200 else []
    test_desigs = [d for d in desigs if d.get('name', '').startswith(P5)]
    check("B6  List designations", resp.status_code == 200 and len(test_desigs) >= 3,
          f"status={resp.status_code} count={len(test_desigs)}")

    # B7: Filter by department
    if dept_finance_id:
        resp = api_get(f'/api/hr/designations/?department={dept_finance_id}', token_admin, SID_A)
        filtered = resp.json() if resp.status_code == 200 else []
        test_filtered = [d for d in filtered if d.get('name', '').startswith(P5)]
        check("B7  Filter by department", resp.status_code == 200 and len(test_filtered) >= 1,
              f"status={resp.status_code} count={len(test_filtered)}")
    else:
        check("B7  Filter by department", False, "no dept id")

    # B8: Update designation
    if desig_sr_id:
        resp = api_patch(f'/api/hr/designations/{desig_sr_id}/', {
            'name': f'{P5}Senior Teacher Updated',
        }, token_admin, SID_A)
        check("B8  Update designation", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("B8  Update designation", False, "no id")

    # B9: Soft-delete designation
    api_post('/api/hr/designations/', {'name': f'{P5}TempDesig'}, token_admin, SID_A)
    temp_desig_id = get_desig_id(f'{P5}TempDesig')
    if temp_desig_id:
        resp = api_delete(f'/api/hr/designations/{temp_desig_id}/', token_admin, SID_A)
        check("B9  Soft-delete designation", resp.status_code in (200, 204),
              f"status={resp.status_code}")
    else:
        check("B9  Soft-delete designation", False, "no id")

    # B10: School B isolation
    resp = api_get('/api/hr/designations/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    test_in_b = [d for d in results if d.get('name', '').startswith(P5)]
    check("B10 School B isolation (empty)", len(test_in_b) == 0,
          f"count={len(test_in_b)}")

    # ==================================================================
    # LEVEL C: STAFF MEMBERS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL C: STAFF MEMBERS API")
    print("=" * 70)

    # C1: Create staff member (Admin)
    resp = api_post('/api/hr/staff/', {
        'first_name': f'{P5}Ahmad',
        'last_name': 'Raza',
        'employee_id': f'{P5}E001',
        'department': dept_finance_id,
        'employment_status': 'ACTIVE',
        'employment_type': 'FULL_TIME',
        'date_of_joining': '2024-06-01',
    }, token_admin, SID_A)
    check("C1  Create staff member (Admin)", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")
    staff_e001_id = get_staff_id(f'{P5}E001')

    # C2: Create staff member (HR Manager)
    resp = api_post('/api/hr/staff/', {
        'first_name': f'{P5}Fatima',
        'last_name': 'Shah',
        'employee_id': f'{P5}E002',
        'department': dept_it_id,
        'employment_status': 'ACTIVE',
        'employment_type': 'PART_TIME',
        'date_of_joining': '2024-09-01',
    }, token_hr, SID_A)
    check("C2  Create staff member (HR Manager)", resp.status_code == 201,
          f"status={resp.status_code}")
    staff_e002_id = get_staff_id(f'{P5}E002')

    # C3: Create staff member (Teacher) -> 403
    resp = api_post('/api/hr/staff/', {
        'first_name': f'{P5}Illegal',
        'last_name': 'Staff',
        'employee_id': f'{P5}E999',
    }, token_teacher, SID_A)
    check("C3  Create staff member (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # C4: Create with all fields
    resp = api_post('/api/hr/staff/', {
        'first_name': f'{P5}Zain',
        'last_name': 'Ali',
        'employee_id': f'{P5}E003',
        'email': f'{P5}zain@test.com',
        'phone': '03001234567',
        'gender': 'MALE',
        'date_of_birth': '1990-01-15',
        'department': dept_finance_id,
        'designation': desig_sr_id if desig_sr_id else None,
        'employment_status': 'ACTIVE',
        'employment_type': 'FULL_TIME',
        'date_of_joining': '2023-01-01',
        'address': '123 Test Street',
        'emergency_contact_name': 'Parent Name',
        'emergency_contact_phone': '03009876543',
        'notes': 'Test staff member',
    }, token_admin, SID_A)
    check("C4  Create with all fields", resp.status_code == 201,
          f"status={resp.status_code}")
    staff_e003_id = get_staff_id(f'{P5}E003')

    # C5: Duplicate employee_id -> 400
    resp = api_post('/api/hr/staff/', {
        'first_name': f'{P5}Dup',
        'last_name': 'Test',
        'employee_id': f'{P5}E001',
    }, token_admin, SID_A)
    check("C5  Duplicate employee_id -> 400", resp.status_code == 400,
          f"status={resp.status_code}")

    # C6: List staff members
    resp = api_get('/api/hr/staff/', token_admin, SID_A)
    staffs = resp.json() if resp.status_code == 200 else []
    test_staff = [s for s in staffs if s.get('employee_id', '').startswith(P5)]
    check("C6  List staff members", resp.status_code == 200 and len(test_staff) >= 3,
          f"status={resp.status_code} count={len(test_staff)}")

    # C7: Search by name
    resp = api_get(f'/api/hr/staff/?search={P5}Ahmad', token_admin, SID_A)
    results = resp.json() if resp.status_code == 200 else []
    check("C7  Search by name", resp.status_code == 200 and len(results) >= 1,
          f"status={resp.status_code} count={len(results)}")

    # C8: Filter by department
    if dept_finance_id:
        resp = api_get(f'/api/hr/staff/?department={dept_finance_id}', token_admin, SID_A)
        results = resp.json() if resp.status_code == 200 else []
        test_filtered = [s for s in results if s.get('employee_id', '').startswith(P5)]
        check("C8  Filter by department", resp.status_code == 200 and len(test_filtered) >= 1,
              f"status={resp.status_code} count={len(test_filtered)}")
    else:
        check("C8  Filter by department", False, "no dept id")

    # C9: Filter by employment_status
    resp = api_get('/api/hr/staff/?employment_status=ACTIVE', token_admin, SID_A)
    check("C9  Filter by employment_status", resp.status_code == 200,
          f"status={resp.status_code}")

    # C10: Filter by employment_type
    resp = api_get('/api/hr/staff/?employment_type=PART_TIME', token_admin, SID_A)
    results = resp.json() if resp.status_code == 200 else []
    test_pt = [s for s in results if s.get('employee_id', '').startswith(P5)]
    check("C10 Filter by employment_type", resp.status_code == 200 and len(test_pt) >= 1,
          f"status={resp.status_code} count={len(test_pt)}")

    # C11: Retrieve single staff
    if staff_e003_id:
        resp = api_get(f'/api/hr/staff/{staff_e003_id}/', token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        check("C11 Retrieve single staff", resp.status_code == 200 and data.get('email') == f'{P5}zain@test.com',
              f"status={resp.status_code} email={data.get('email')}")
    else:
        check("C11 Retrieve single staff", False, "no id")

    # C12: Update staff (PATCH)
    if staff_e001_id:
        resp = api_patch(f'/api/hr/staff/{staff_e001_id}/', {
            'phone': '03111111111',
        }, token_admin, SID_A)
        check("C12 Update staff (PATCH)", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("C12 Update staff (PATCH)", False, "no id")

    # C13: Soft-delete staff
    api_post('/api/hr/staff/', {
        'first_name': f'{P5}Temp', 'last_name': 'Del', 'employee_id': f'{P5}EDEL',
    }, token_admin, SID_A)
    temp_staff_id = get_staff_id(f'{P5}EDEL')
    if temp_staff_id:
        resp = api_delete(f'/api/hr/staff/{temp_staff_id}/', token_admin, SID_A)
        check("C13 Soft-delete staff", resp.status_code in (200, 204),
              f"status={resp.status_code}")
        obj = StaffMember.objects.filter(id=temp_staff_id).first()
        check("C13b is_active=False", obj and not obj.is_active, "")
    else:
        check("C13 Soft-delete staff", False, "no id")
        check("C13b is_active=False", False, "no id")

    # C14: Dashboard stats
    resp = api_get('/api/hr/staff/dashboard_stats/', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else {}
    check("C14 Dashboard stats", resp.status_code == 200 and 'total_staff' in data,
          f"status={resp.status_code} keys={list(data.keys())[:5]}")

    # C15: School B isolation
    resp = api_get('/api/hr/staff/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    test_in_b = [s for s in results if s.get('employee_id', '').startswith(P5)]
    check("C15 School B isolation (empty)", len(test_in_b) == 0,
          f"count={len(test_in_b)}")

    # ==================================================================
    # LEVEL D: SALARY STRUCTURES API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL D: SALARY STRUCTURES API")
    print("=" * 70)

    # D1: Create salary structure (Admin)
    if staff_e001_id:
        resp = api_post('/api/hr/salary-structures/', {
            'staff_member': staff_e001_id,
            'basic_salary': '50000.00',
            'allowances': {'house_rent': 10000, 'transport': 5000},
            'deductions': {'tax': 3000, 'provident_fund': 2000},
            'effective_from': '2024-06-01',
            'is_active': True,
        }, token_admin, SID_A)
        check("D1  Create salary structure (Admin)", resp.status_code == 201,
              f"status={resp.status_code} body={resp.content[:200]}")
    else:
        check("D1  Create salary structure (Admin)", False, "no staff id")

    # D2: Create with JSON allowances+deductions
    if staff_e002_id:
        resp = api_post('/api/hr/salary-structures/', {
            'staff_member': staff_e002_id,
            'basic_salary': '30000.00',
            'allowances': {'transport': 3000},
            'deductions': {'tax': 1500},
            'effective_from': '2024-09-01',
            'is_active': True,
        }, token_admin, SID_A)
        check("D2  Create with JSON allowances+deductions", resp.status_code == 201,
              f"status={resp.status_code}")
    else:
        check("D2  Create with JSON allowances+deductions", False, "no staff id")

    # D3: Create (Teacher) -> 403
    resp = api_post('/api/hr/salary-structures/', {
        'staff_member': staff_1.id,
        'basic_salary': '25000.00',
        'effective_from': '2024-01-01',
    }, token_teacher, SID_A)
    check("D3  Create salary structure (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # D4: List salary structures
    resp = api_get('/api/hr/salary-structures/', token_admin, SID_A)
    check("D4  List salary structures", resp.status_code == 200,
          f"status={resp.status_code}")

    # D5: Filter by staff_member
    if staff_e001_id:
        resp = api_get(f'/api/hr/salary-structures/?staff_member={staff_e001_id}', token_admin, SID_A)
        results = resp.json() if resp.status_code == 200 else []
        check("D5  Filter by staff_member", resp.status_code == 200 and len(results) >= 1,
              f"status={resp.status_code} count={len(results)}")
    else:
        check("D5  Filter by staff_member", False, "no id")

    # D6: Get current structure
    if staff_e001_id:
        resp = api_get(f'/api/hr/salary-structures/current/?staff_member={staff_e001_id}', token_admin, SID_A)
        check("D6  Get current structure", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("D6  Get current structure", False, "no id")

    # D7: Update structure
    sal_qs = SalaryStructure.objects.filter(school=school_a, staff_member_id=staff_e001_id)
    sal_id = sal_qs.first().id if sal_qs.exists() else None
    if sal_id:
        resp = api_patch(f'/api/hr/salary-structures/{sal_id}/', {
            'basic_salary': '55000.00',
        }, token_admin, SID_A)
        check("D7  Update structure", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("D7  Update structure", False, "no id")

    # D8: Soft-delete structure (create temp then delete)
    if staff_e003_id:
        api_post('/api/hr/salary-structures/', {
            'staff_member': staff_e003_id,
            'basic_salary': '20000.00',
            'effective_from': '2024-01-01',
            'is_active': True,
        }, token_admin, SID_A)
        temp_sal = SalaryStructure.objects.filter(school=school_a, staff_member_id=staff_e003_id).first()
        if temp_sal:
            resp = api_delete(f'/api/hr/salary-structures/{temp_sal.id}/', token_admin, SID_A)
            check("D8  Soft-delete structure", resp.status_code in (200, 204),
                  f"status={resp.status_code}")
        else:
            check("D8  Soft-delete structure", False, "no temp sal")
    else:
        check("D8  Soft-delete structure", False, "no staff id")

    # D9: Computed fields (gross, net, deductions)
    if sal_id:
        resp = api_get(f'/api/hr/salary-structures/{sal_id}/', token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        gross = float(data.get('gross_salary', 0))
        net = float(data.get('net_salary', 0))
        total_ded = float(data.get('total_deductions', 0))
        basic = float(data.get('basic_salary', 0))
        check("D9  Computed fields", gross > basic and net < gross and total_ded > 0,
              f"basic={basic} gross={gross} net={net} deductions={total_ded}")
    else:
        check("D9  Computed fields", False, "no id")

    # D10: School B isolation
    resp = api_get('/api/hr/salary-structures/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    check("D10 School B isolation (empty)", resp.status_code == 200 and len(results) == 0,
          f"status={resp.status_code} count={len(results)}")

    # ==================================================================
    # LEVEL E: PAYSLIPS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL E: PAYSLIPS API")
    print("=" * 70)

    # E1: Create payslip (Admin)
    if staff_e001_id:
        resp = api_post('/api/hr/payslips/', {
            'staff_member': staff_e001_id,
            'month': 1,
            'year': 2026,
            'basic_salary': '55000.00',
            'total_allowances': '15000.00',
            'total_deductions': '5000.00',
            'net_salary': '65000.00',
            'working_days': 22,
            'present_days': 20,
            'status': 'DRAFT',
        }, token_admin, SID_A)
        check("E1  Create payslip (Admin)", resp.status_code == 201,
              f"status={resp.status_code} body={resp.content[:200]}")
    else:
        check("E1  Create payslip (Admin)", False, "no staff id")

    # E2: Create (Teacher) -> 403
    resp = api_post('/api/hr/payslips/', {
        'staff_member': staff_1.id,
        'month': 1, 'year': 2026,
        'basic_salary': '25000', 'total_allowances': '0',
        'total_deductions': '0', 'net_salary': '25000',
    }, token_teacher, SID_A)
    check("E2  Create payslip (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # E3: Duplicate month+year+staff -> 400
    if staff_e001_id:
        resp = api_post('/api/hr/payslips/', {
            'staff_member': staff_e001_id,
            'month': 1, 'year': 2026,
            'basic_salary': '55000', 'total_allowances': '0',
            'total_deductions': '0', 'net_salary': '55000',
        }, token_admin, SID_A)
        check("E3  Duplicate month+year+staff -> 400", resp.status_code == 400,
              f"status={resp.status_code}")
    else:
        check("E3  Duplicate month+year+staff -> 400", False, "no id")

    # E4: Bulk generate payslips (month 2)
    resp = api_post('/api/hr/payslips/generate_payslips/', {
        'month': 2,
        'year': 2026,
    }, token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else {}
    check("E4  Bulk generate payslips", resp.status_code == 200 and data.get('created', 0) >= 1,
          f"status={resp.status_code} data={data}")

    # E5: Bulk generate skips existing
    resp = api_post('/api/hr/payslips/generate_payslips/', {
        'month': 2,
        'year': 2026,
    }, token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else {}
    check("E5  Bulk generate skips existing", resp.status_code == 200 and data.get('skipped', 0) >= 1,
          f"status={resp.status_code} data={data}")

    # E6: List payslips
    resp = api_get('/api/hr/payslips/', token_admin, SID_A)
    check("E6  List payslips", resp.status_code == 200,
          f"status={resp.status_code}")

    # E7: Filter by month/year
    resp = api_get('/api/hr/payslips/?month=1&year=2026', token_admin, SID_A)
    results = resp.json() if resp.status_code == 200 else []
    check("E7  Filter by month/year", resp.status_code == 200 and len(results) >= 1,
          f"status={resp.status_code} count={len(results)}")

    # E8: Filter by status
    resp = api_get('/api/hr/payslips/?status=DRAFT', token_admin, SID_A)
    check("E8  Filter by status", resp.status_code == 200,
          f"status={resp.status_code}")

    # E9: Approve payslip
    payslip = Payslip.objects.filter(school=school_a, staff_member_id=staff_e001_id, month=1, year=2026).first()
    if payslip:
        resp = api_post(f'/api/hr/payslips/{payslip.id}/approve/', {}, token_admin, SID_A)
        check("E9  Approve payslip", resp.status_code == 200,
              f"status={resp.status_code}")
        payslip.refresh_from_db()
        check("E9b status=APPROVED", payslip.status == 'APPROVED',
              f"status={payslip.status}")
    else:
        check("E9  Approve payslip", False, "no payslip")
        check("E9b status=APPROVED", False, "no payslip")

    # E10: Mark payslip paid
    if payslip:
        resp = api_post(f'/api/hr/payslips/{payslip.id}/mark_paid/', {}, token_admin, SID_A)
        check("E10 Mark payslip paid", resp.status_code == 200,
              f"status={resp.status_code}")
        payslip.refresh_from_db()
        check("E10b status=PAID", payslip.status == 'PAID',
              f"status={payslip.status}")
    else:
        check("E10 Mark payslip paid", False, "no payslip")
        check("E10b status=PAID", False, "no payslip")

    # E11: Payroll summary
    resp = api_get('/api/hr/payslips/payroll_summary/?month=2&year=2026', token_admin, SID_A)
    data = resp.json() if resp.status_code == 200 else {}
    check("E11 Payroll summary", resp.status_code == 200 and 'total_payslips' in data,
          f"status={resp.status_code} keys={list(data.keys())[:5]}")

    # E12: School B isolation
    resp = api_get('/api/hr/payslips/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    check("E12 School B isolation (empty)", resp.status_code == 200 and len(results) == 0,
          f"status={resp.status_code} count={len(results)}")

    # ==================================================================
    # LEVEL F: LEAVE POLICIES API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL F: LEAVE POLICIES API")
    print("=" * 70)

    # F1: Create leave policy (Admin)
    resp = api_post('/api/hr/leave-policies/', {
        'name': f'{P5}Annual Leave',
        'leave_type': 'ANNUAL',
        'days_allowed': 20,
        'carry_forward': True,
    }, token_admin, SID_A)
    check("F1  Create leave policy (Admin)", resp.status_code == 201,
          f"status={resp.status_code} body={resp.content[:200]}")

    # F2: Create multiple types
    for lt_name, lt_type, days in [('Sick Leave', 'SICK', 10), ('Casual Leave', 'CASUAL', 5)]:
        resp = api_post('/api/hr/leave-policies/', {
            'name': f'{P5}{lt_name}',
            'leave_type': lt_type,
            'days_allowed': days,
        }, token_admin, SID_A)
    check("F2  Create multiple types", resp.status_code == 201,
          f"status={resp.status_code}")

    # F3: Create (Teacher) -> 403
    resp = api_post('/api/hr/leave-policies/', {
        'name': f'{P5}Illegal Policy',
        'leave_type': 'ANNUAL',
        'days_allowed': 99,
    }, token_teacher, SID_A)
    check("F3  Create leave policy (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # F4: List policies
    resp = api_get('/api/hr/leave-policies/', token_admin, SID_A)
    policies = resp.json() if resp.status_code == 200 else []
    test_pol = [p for p in policies if p.get('name', '').startswith(P5)]
    check("F4  List policies", resp.status_code == 200 and len(test_pol) >= 3,
          f"status={resp.status_code} count={len(test_pol)}")

    # Get policy IDs for later
    annual_policy = LeavePolicy.objects.filter(school=school_a, name=f'{P5}Annual Leave').first()
    sick_policy = LeavePolicy.objects.filter(school=school_a, name=f'{P5}Sick Leave').first()

    # F5: Update policy
    if annual_policy:
        resp = api_patch(f'/api/hr/leave-policies/{annual_policy.id}/', {
            'days_allowed': 25,
        }, token_admin, SID_A)
        check("F5  Update policy", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("F5  Update policy", False, "no id")

    # F6: Soft-delete policy
    api_post('/api/hr/leave-policies/', {
        'name': f'{P5}TempPolicy', 'leave_type': 'OTHER', 'days_allowed': 1,
    }, token_admin, SID_A)
    temp_pol = LeavePolicy.objects.filter(school=school_a, name=f'{P5}TempPolicy').first()
    if temp_pol:
        resp = api_delete(f'/api/hr/leave-policies/{temp_pol.id}/', token_admin, SID_A)
        check("F6  Soft-delete policy", resp.status_code in (200, 204),
              f"status={resp.status_code}")
    else:
        check("F6  Soft-delete policy", False, "no id")

    # F7: School B isolation
    resp = api_get('/api/hr/leave-policies/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    test_in_b = [p for p in results if p.get('name', '').startswith(P5)]
    check("F7  School B isolation (empty)", len(test_in_b) == 0,
          f"count={len(test_in_b)}")

    # ==================================================================
    # LEVEL G: LEAVE APPLICATIONS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL G: LEAVE APPLICATIONS API")
    print("=" * 70)

    # G1: Create leave application (Admin)
    if staff_e001_id and annual_policy:
        resp = api_post('/api/hr/leave-applications/', {
            'staff_member': staff_e001_id,
            'leave_policy': annual_policy.id,
            'start_date': '2026-03-01',
            'end_date': '2026-03-05',
            'reason': 'Family vacation',
        }, token_admin, SID_A)
        check("G1  Create leave application (Admin)", resp.status_code == 201,
              f"status={resp.status_code} body={resp.content[:200]}")
    else:
        check("G1  Create leave application (Admin)", False, "missing ids")

    # G2: Create (Teacher) -> 403
    resp = api_post('/api/hr/leave-applications/', {
        'staff_member': staff_1.id,
        'start_date': '2026-04-01',
        'end_date': '2026-04-02',
        'reason': 'Test',
    }, token_teacher, SID_A)
    check("G2  Create leave application (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # Create a second application for testing approve/reject
    if staff_e002_id and sick_policy:
        api_post('/api/hr/leave-applications/', {
            'staff_member': staff_e002_id,
            'leave_policy': sick_policy.id,
            'start_date': '2026-03-10',
            'end_date': '2026-03-12',
            'reason': 'Medical checkup',
        }, token_admin, SID_A)

    # G3: List applications
    resp = api_get('/api/hr/leave-applications/', token_admin, SID_A)
    apps = resp.json() if resp.status_code == 200 else []
    check("G3  List applications", resp.status_code == 200 and len(apps) >= 1,
          f"status={resp.status_code} count={len(apps)}")

    # G4: Filter by status
    resp = api_get('/api/hr/leave-applications/?status=PENDING', token_admin, SID_A)
    check("G4  Filter by status", resp.status_code == 200,
          f"status={resp.status_code}")

    # G5: Filter by staff_member
    if staff_e001_id:
        resp = api_get(f'/api/hr/leave-applications/?staff_member={staff_e001_id}', token_admin, SID_A)
        results = resp.json() if resp.status_code == 200 else []
        check("G5  Filter by staff_member", resp.status_code == 200 and len(results) >= 1,
              f"status={resp.status_code} count={len(results)}")
    else:
        check("G5  Filter by staff_member", False, "no id")

    # G6: Approve application
    app1 = LeaveApplication.objects.filter(school=school_a, staff_member_id=staff_e001_id, status='PENDING').first()
    if app1:
        resp = api_post(f'/api/hr/leave-applications/{app1.id}/approve/', {
            'admin_remarks': 'Approved for vacation',
        }, token_admin, SID_A)
        check("G6  Approve application", resp.status_code == 200,
              f"status={resp.status_code}")
        app1.refresh_from_db()
        check("G6b status=APPROVED", app1.status == 'APPROVED',
              f"status={app1.status}")
    else:
        check("G6  Approve application", False, "no pending app")
        check("G6b status=APPROVED", False, "no app")

    # G7: Reject application
    app2 = LeaveApplication.objects.filter(school=school_a, staff_member_id=staff_e002_id, status='PENDING').first()
    if app2:
        resp = api_post(f'/api/hr/leave-applications/{app2.id}/reject/', {
            'admin_remarks': 'Insufficient leave balance',
        }, token_admin, SID_A)
        check("G7  Reject application", resp.status_code == 200,
              f"status={resp.status_code}")
        app2.refresh_from_db()
        check("G7b status=REJECTED", app2.status == 'REJECTED',
              f"status={app2.status}")
    else:
        check("G7  Reject application", False, "no pending app")
        check("G7b status=REJECTED", False, "no app")

    # G8: Cancel application (create a new one first)
    if staff_e003_id and annual_policy:
        api_post('/api/hr/leave-applications/', {
            'staff_member': staff_e003_id,
            'leave_policy': annual_policy.id,
            'start_date': '2026-04-01',
            'end_date': '2026-04-03',
            'reason': 'Personal work',
        }, token_admin, SID_A)
        app3 = LeaveApplication.objects.filter(school=school_a, staff_member_id=staff_e003_id, status='PENDING').first()
        if app3:
            resp = api_post(f'/api/hr/leave-applications/{app3.id}/cancel/', {}, token_admin, SID_A)
            check("G8  Cancel application", resp.status_code == 200,
                  f"status={resp.status_code}")
        else:
            check("G8  Cancel application", False, "no app created")
    else:
        check("G8  Cancel application", False, "missing ids")

    # G9: Cannot approve non-pending
    if app1:
        resp = api_post(f'/api/hr/leave-applications/{app1.id}/approve/', {}, token_admin, SID_A)
        check("G9  Cannot approve non-pending", resp.status_code == 400,
              f"status={resp.status_code}")
    else:
        check("G9  Cannot approve non-pending", False, "no app")

    # G10: Leave balance
    if staff_e001_id:
        resp = api_get(f'/api/hr/leave-applications/leave_balance/?staff_member={staff_e001_id}', token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else []
        has_balance = isinstance(data, list) and len(data) >= 1
        check("G10 Leave balance", resp.status_code == 200 and has_balance,
              f"status={resp.status_code} count={len(data) if isinstance(data, list) else 'N/A'}")
    else:
        check("G10 Leave balance", False, "no staff id")

    # G11: School B isolation
    resp = api_get('/api/hr/leave-applications/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    check("G11 School B isolation (empty)", resp.status_code == 200 and len(results) == 0,
          f"status={resp.status_code} count={len(results)}")

    # ==================================================================
    # LEVEL H: STAFF ATTENDANCE API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL H: STAFF ATTENDANCE API")
    print("=" * 70)

    att_date = '2026-02-10'
    att_date2 = '2026-02-11'

    # H1: Create attendance record (Admin)
    if staff_e001_id:
        resp = api_post('/api/hr/attendance/', {
            'staff_member': staff_e001_id,
            'date': att_date,
            'status': 'PRESENT',
        }, token_admin, SID_A)
        check("H1  Create attendance record (Admin)", resp.status_code == 201,
              f"status={resp.status_code} body={resp.content[:200]}")
    else:
        check("H1  Create attendance record (Admin)", False, "no staff id")

    # H2: Create with check_in/check_out
    if staff_e002_id:
        resp = api_post('/api/hr/attendance/', {
            'staff_member': staff_e002_id,
            'date': att_date,
            'status': 'PRESENT',
            'check_in': '08:00:00',
            'check_out': '16:00:00',
        }, token_admin, SID_A)
        check("H2  Create with check_in/check_out", resp.status_code == 201,
              f"status={resp.status_code}")
    else:
        check("H2  Create with check_in/check_out", False, "no staff id")

    # H3: Create (Teacher) -> 403
    resp = api_post('/api/hr/attendance/', {
        'staff_member': staff_1.id,
        'date': att_date,
        'status': 'PRESENT',
    }, token_teacher, SID_A)
    check("H3  Create attendance (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # H4: Duplicate staff+date -> 400
    if staff_e001_id:
        resp = api_post('/api/hr/attendance/', {
            'staff_member': staff_e001_id,
            'date': att_date,
            'status': 'ABSENT',
        }, token_admin, SID_A)
        check("H4  Duplicate staff+date -> 400", resp.status_code == 400,
              f"status={resp.status_code}")
    else:
        check("H4  Duplicate staff+date -> 400", False, "no staff id")

    # H5: List attendance
    resp = api_get('/api/hr/attendance/', token_admin, SID_A)
    check("H5  List attendance", resp.status_code == 200,
          f"status={resp.status_code}")

    # H6: Filter by date
    resp = api_get(f'/api/hr/attendance/?date={att_date}', token_admin, SID_A)
    results = resp.json() if resp.status_code == 200 else []
    check("H6  Filter by date", resp.status_code == 200 and len(results) >= 1,
          f"status={resp.status_code} count={len(results)}")

    # H7: Filter by staff_member
    if staff_e001_id:
        resp = api_get(f'/api/hr/attendance/?staff_member={staff_e001_id}', token_admin, SID_A)
        results = resp.json() if resp.status_code == 200 else []
        check("H7  Filter by staff_member", resp.status_code == 200 and len(results) >= 1,
              f"status={resp.status_code} count={len(results)}")
    else:
        check("H7  Filter by staff_member", False, "no id")

    # H8: Filter by status
    resp = api_get('/api/hr/attendance/?status=PRESENT', token_admin, SID_A)
    check("H8  Filter by status", resp.status_code == 200,
          f"status={resp.status_code}")

    # H9: Bulk mark attendance
    if staff_e001_id and staff_e002_id and staff_e003_id:
        resp = api_post('/api/hr/attendance/bulk_mark/', {
            'date': att_date2,
            'records': [
                {'staff_member': staff_e001_id, 'status': 'PRESENT', 'check_in': '08:00', 'check_out': '16:00'},
                {'staff_member': staff_e002_id, 'status': 'ABSENT'},
                {'staff_member': staff_e003_id, 'status': 'LATE', 'check_in': '09:30'},
            ],
        }, token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        check("H9  Bulk mark attendance", resp.status_code == 200 and data.get('created', 0) >= 1,
              f"status={resp.status_code} data={data}")
    else:
        check("H9  Bulk mark attendance", False, "missing staff ids")

    # H10: Bulk mark updates existing
    if staff_e001_id and staff_e002_id:
        resp = api_post('/api/hr/attendance/bulk_mark/', {
            'date': att_date2,
            'records': [
                {'staff_member': staff_e001_id, 'status': 'LATE'},
                {'staff_member': staff_e002_id, 'status': 'PRESENT'},
            ],
        }, token_admin, SID_A)
        data = resp.json() if resp.status_code == 200 else {}
        check("H10 Bulk mark updates existing", resp.status_code == 200 and data.get('updated', 0) >= 1,
              f"status={resp.status_code} data={data}")
    else:
        check("H10 Bulk mark updates existing", False, "missing staff ids")

    # H11: Attendance summary
    resp = api_get(f'/api/hr/attendance/summary/?date_from={att_date}&date_to={att_date2}', token_admin, SID_A)
    check("H11 Attendance summary", resp.status_code == 200,
          f"status={resp.status_code}")

    # H12: School B isolation
    resp = api_get('/api/hr/attendance/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    check("H12 School B isolation (empty)", resp.status_code == 200 and len(results) == 0,
          f"status={resp.status_code} count={len(results)}")

    # ==================================================================
    # LEVEL I: PERFORMANCE APPRAISALS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL I: PERFORMANCE APPRAISALS API")
    print("=" * 70)

    # I1: Create appraisal (Admin)
    if staff_e001_id:
        resp = api_post('/api/hr/appraisals/', {
            'staff_member': staff_e001_id,
            'review_period_start': '2025-01-01',
            'review_period_end': '2025-12-31',
            'rating': 4,
            'strengths': 'Good teamwork',
            'areas_for_improvement': 'Time management',
            'goals': 'Complete certification',
            'comments': 'Overall good performance',
        }, token_admin, SID_A)
        check("I1  Create appraisal (Admin)", resp.status_code == 201,
              f"status={resp.status_code} body={resp.content[:200]}")
    else:
        check("I1  Create appraisal (Admin)", False, "no staff id")

    # I2: Create (Teacher) -> 403
    resp = api_post('/api/hr/appraisals/', {
        'staff_member': staff_1.id,
        'review_period_start': '2025-01-01',
        'review_period_end': '2025-06-30',
        'rating': 3,
    }, token_teacher, SID_A)
    check("I2  Create appraisal (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # I3: List appraisals
    resp = api_get('/api/hr/appraisals/', token_admin, SID_A)
    check("I3  List appraisals", resp.status_code == 200,
          f"status={resp.status_code}")

    # I4: Filter by staff_member
    if staff_e001_id:
        resp = api_get(f'/api/hr/appraisals/?staff_member={staff_e001_id}', token_admin, SID_A)
        results = resp.json() if resp.status_code == 200 else []
        check("I4  Filter by staff_member", resp.status_code == 200 and len(results) >= 1,
              f"status={resp.status_code} count={len(results)}")
    else:
        check("I4  Filter by staff_member", False, "no id")

    # I5: Update appraisal
    appr = PerformanceAppraisal.objects.filter(school=school_a, staff_member_id=staff_e001_id).first()
    if appr:
        resp = api_patch(f'/api/hr/appraisals/{appr.id}/', {
            'rating': 5,
            'comments': 'Excellent performance',
        }, token_admin, SID_A)
        check("I5  Update appraisal", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("I5  Update appraisal", False, "no id")

    # I6: School B isolation
    resp = api_get('/api/hr/appraisals/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    check("I6  School B isolation (empty)", resp.status_code == 200 and len(results) == 0,
          f"status={resp.status_code} count={len(results)}")

    # ==================================================================
    # LEVEL J: STAFF QUALIFICATIONS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL J: STAFF QUALIFICATIONS API")
    print("=" * 70)

    # J1: Create qualification (Admin)
    if staff_e001_id:
        resp = api_post('/api/hr/qualifications/', {
            'staff_member': staff_e001_id,
            'qualification_type': 'DEGREE',
            'qualification_name': f'{P5}MBA Finance',
            'institution': 'IBA Karachi',
            'year_of_completion': 2020,
            'grade_or_percentage': '3.5 GPA',
        }, token_admin, SID_A)
        check("J1  Create qualification (Admin)", resp.status_code == 201,
              f"status={resp.status_code} body={resp.content[:200]}")
    else:
        check("J1  Create qualification (Admin)", False, "no staff id")

    # J2: Create multiple types
    if staff_e001_id:
        resp = api_post('/api/hr/qualifications/', {
            'staff_member': staff_e001_id,
            'qualification_type': 'CERTIFICATION',
            'qualification_name': f'{P5}PMP Certified',
            'institution': 'PMI',
            'year_of_completion': 2022,
        }, token_admin, SID_A)
        check("J2  Create multiple types", resp.status_code == 201,
              f"status={resp.status_code}")
    else:
        check("J2  Create multiple types", False, "no staff id")

    # J3: Create (Teacher) -> 403
    resp = api_post('/api/hr/qualifications/', {
        'staff_member': staff_1.id,
        'qualification_type': 'DEGREE',
        'qualification_name': 'Test',
        'institution': 'Test',
    }, token_teacher, SID_A)
    check("J3  Create qualification (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # J4: List qualifications
    resp = api_get('/api/hr/qualifications/', token_admin, SID_A)
    check("J4  List qualifications", resp.status_code == 200,
          f"status={resp.status_code}")

    # J5: Filter by staff_member
    if staff_e001_id:
        resp = api_get(f'/api/hr/qualifications/?staff_member={staff_e001_id}', token_admin, SID_A)
        results = resp.json() if resp.status_code == 200 else []
        check("J5  Filter by staff_member", resp.status_code == 200 and len(results) >= 2,
              f"status={resp.status_code} count={len(results)}")
    else:
        check("J5  Filter by staff_member", False, "no id")

    # J6: Filter by type
    resp = api_get('/api/hr/qualifications/?qualification_type=DEGREE', token_admin, SID_A)
    check("J6  Filter by type", resp.status_code == 200,
          f"status={resp.status_code}")

    # J7: Update qualification
    qual = StaffQualification.objects.filter(school=school_a, qualification_name__startswith=P5).first()
    if qual:
        resp = api_patch(f'/api/hr/qualifications/{qual.id}/', {
            'grade_or_percentage': '3.8 GPA',
        }, token_admin, SID_A)
        check("J7  Update qualification", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("J7  Update qualification", False, "no id")

    # J8: School B isolation
    resp = api_get('/api/hr/qualifications/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    check("J8  School B isolation (empty)", resp.status_code == 200 and len(results) == 0,
          f"status={resp.status_code} count={len(results)}")

    # ==================================================================
    # LEVEL K: STAFF DOCUMENTS API
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL K: STAFF DOCUMENTS API")
    print("=" * 70)

    # K1: Create document (Admin)
    if staff_e001_id:
        resp = api_post('/api/hr/documents/', {
            'staff_member': staff_e001_id,
            'document_type': 'CONTRACT',
            'title': f'{P5}Employment Contract',
            'file_url': 'https://example.com/contract.pdf',
            'notes': 'Signed copy',
        }, token_admin, SID_A)
        check("K1  Create document (Admin)", resp.status_code == 201,
              f"status={resp.status_code} body={resp.content[:200]}")
    else:
        check("K1  Create document (Admin)", False, "no staff id")

    # K2: Create (Teacher) -> 403
    resp = api_post('/api/hr/documents/', {
        'staff_member': staff_1.id,
        'document_type': 'OTHER',
        'title': 'Test',
        'file_url': 'https://example.com/test.pdf',
    }, token_teacher, SID_A)
    check("K2  Create document (Teacher) -> 403", resp.status_code == 403,
          f"status={resp.status_code}")

    # K3: List documents
    resp = api_get('/api/hr/documents/', token_admin, SID_A)
    check("K3  List documents", resp.status_code == 200,
          f"status={resp.status_code}")

    # K4: Filter by staff_member
    if staff_e001_id:
        resp = api_get(f'/api/hr/documents/?staff_member={staff_e001_id}', token_admin, SID_A)
        results = resp.json() if resp.status_code == 200 else []
        check("K4  Filter by staff_member", resp.status_code == 200 and len(results) >= 1,
              f"status={resp.status_code} count={len(results)}")
    else:
        check("K4  Filter by staff_member", False, "no id")

    # K5: Filter by type
    resp = api_get('/api/hr/documents/?document_type=CONTRACT', token_admin, SID_A)
    check("K5  Filter by type", resp.status_code == 200,
          f"status={resp.status_code}")

    # K6: Update document
    doc = StaffDocument.objects.filter(school=school_a, title__startswith=P5).first()
    if doc:
        resp = api_patch(f'/api/hr/documents/{doc.id}/', {
            'notes': 'Updated notes',
        }, token_admin, SID_A)
        check("K6  Update document", resp.status_code == 200,
              f"status={resp.status_code}")
    else:
        check("K6  Update document", False, "no id")

    # K7: School B isolation
    resp = api_get('/api/hr/documents/', token_admin_b, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    check("K7  School B isolation (empty)", resp.status_code == 200 and len(results) == 0,
          f"status={resp.status_code} count={len(results)}")

    # ==================================================================
    # LEVEL L: CROSS-CUTTING TESTS
    # ==================================================================
    print("\n" + "=" * 70)
    print("  LEVEL L: CROSS-CUTTING TESTS")
    print("=" * 70)

    # L1: Unauthenticated -> 401
    resp = _client.get('/api/hr/staff/')
    check("L1  Unauthenticated -> 401", resp.status_code == 401,
          f"status={resp.status_code}")

    # L2: Invalid token -> 401
    resp = _client.get('/api/hr/staff/',
                       HTTP_AUTHORIZATION='Bearer invalid_garbage_token',
                       HTTP_X_SCHOOL_ID=str(SID_A))
    check("L2  Invalid token -> 401", resp.status_code == 401,
          f"status={resp.status_code}")

    # L3: Wrong school header -> no data
    resp = api_get('/api/hr/staff/', token_admin, SID_B)
    results = resp.json() if resp.status_code == 200 else []
    test_in_wrong = [s for s in results if s.get('employee_id', '').startswith(P5)]
    check("L3  Wrong school header -> no data", len(test_in_wrong) == 0,
          f"count={len(test_in_wrong)}")

    # L4: HR Manager full write access
    resp = api_post('/api/hr/departments/', {
        'name': f'{P5}HR Test Dept',
    }, token_hr, SID_A)
    check("L4  HR Manager write access", resp.status_code == 201,
          f"status={resp.status_code}")

    # L5: Teacher read-only
    resp = api_get('/api/hr/departments/', token_teacher, SID_A)
    check("L5a Teacher can READ departments", resp.status_code == 200,
          f"status={resp.status_code}")
    resp = api_post('/api/hr/departments/', {'name': f'{P5}No'}, token_teacher, SID_A)
    check("L5b Teacher can't POST departments", resp.status_code == 403,
          f"status={resp.status_code}")

    # L6: Data integrity
    final_dept_count = StaffDepartment.objects.exclude(school__name__startswith=SEED_PREFIX).exclude(name__startswith=P5).count()
    final_staff_count = StaffMember.objects.exclude(school__name__startswith=SEED_PREFIX).exclude(first_name__startswith=P5).count()
    check("L6a Original departments untouched", final_dept_count == orig_dept_count,
          f"before={orig_dept_count} after={final_dept_count}")
    check("L6b Original staff untouched", final_staff_count == orig_staff_count,
          f"before={orig_staff_count} after={final_staff_count}")

    # ==================================================================
    # RESULTS
    # ==================================================================
    print("\n" + "=" * 70)
    total = passed + failed
    print(f"  RESULTS: {passed} passed / {failed} failed / {total} total")
    if failed == 0:
        print("  ALL TESTS PASSED!")
    print("=" * 70)

except Exception as e:
    print(f"\n[ERROR] Test suite crashed: {e}")
    traceback.print_exc()

finally:
    # ── Cleanup Phase 5 specific data ──
    print("\n[CLEANUP] Removing Phase 5 test data...")

    StaffDocument.objects.filter(school__name__startswith=SEED_PREFIX, title__startswith=P5).delete()
    print("   Deleted: StaffDocuments")

    StaffQualification.objects.filter(school__name__startswith=SEED_PREFIX, qualification_name__startswith=P5).delete()
    print("   Deleted: StaffQualifications")

    PerformanceAppraisal.objects.filter(school__name__startswith=SEED_PREFIX).delete()
    print("   Deleted: PerformanceAppraisals")

    StaffAttendance.objects.filter(school__name__startswith=SEED_PREFIX).delete()
    print("   Deleted: StaffAttendance")

    LeaveApplication.objects.filter(school__name__startswith=SEED_PREFIX).delete()
    print("   Deleted: LeaveApplications")

    LeavePolicy.objects.filter(school__name__startswith=SEED_PREFIX, name__startswith=P5).delete()
    print("   Deleted: LeavePolicies")

    Payslip.objects.filter(school__name__startswith=SEED_PREFIX).delete()
    print("   Deleted: Payslips")

    SalaryStructure.objects.filter(school__name__startswith=SEED_PREFIX).delete()
    print("   Deleted: SalaryStructures")

    StaffMember.objects.filter(school__name__startswith=SEED_PREFIX, first_name__startswith=P5).delete()
    print("   Deleted: P5 StaffMembers")

    StaffDesignation.objects.filter(school__name__startswith=SEED_PREFIX, name__startswith=P5).delete()
    print("   Deleted: P5 StaffDesignations")

    StaffDepartment.objects.filter(school__name__startswith=SEED_PREFIX, name__startswith=P5).delete()
    print("   Deleted: P5 StaffDepartments")

    print("[CLEANUP] Phase 5 data removed. Seed data preserved.\n")
    print("Done.")
