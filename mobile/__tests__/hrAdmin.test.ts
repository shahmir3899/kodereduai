import {
  documentFileProblem, DOCUMENT_MAX_BYTES, attendanceToday, attentionItems, buildDepartmentPayload, buildDesignationPayload, buildLeavePolicyPayload, buildQualificationPayload,
  buildStaffPayload, daysToExpiry, designationsFor, documentFields, emptyDepartmentForm, emptyDocumentForm, emptyLeavePolicyForm,
  emptyQualificationForm, emptyStaffForm, expiryLabel, labelOf, leavePolicySubtitle, staffAccountRoles, staffHasLeft, staffSubtitle,
  staffToForm, validateDepartment, validateDocument, validateLeavePolicy, validateQualification, validateStaff, withDepartment,
  withDesignation, EMPLOYMENT_STATUSES, type HrStats, type StaffRow,
} from '../services/hrAdmin';

const staff = (over: Partial<StaffRow> = {}): StaffRow => ({
  id: 1, full_name: 'Ali Khan', first_name: 'Ali', last_name: 'Khan', department: 2, department_name: 'Science', designation: 5, designation_name: 'Teacher',
  employee_id: 'EMP-001', employment_type: 'FULL_TIME', employment_status: 'ACTIVE', is_active: true, ...over,
});

describe('staff list', () => {
  it('reads the names the API really sends', () => {
    expect(staffSubtitle(staff())).toBe('Teacher  ·  Science');
    expect(staffSubtitle(staff({ designation_name: null }))).toBe('Science');
  });

  it('marks people who have left', () => {
    expect(staffHasLeft(staff())).toBe(false);
    expect(staffHasLeft(staff({ employment_status: 'RESIGNED' }))).toBe(true);
    expect(staffHasLeft(staff({ is_active: false }))).toBe(true);
    expect(labelOf(EMPLOYMENT_STATUSES, 'ON_LEAVE')).toBe('On leave');
  });
});

describe('staff form', () => {
  const ok = { ...emptyStaffForm('EMP-009'), firstName: ' Sara ', lastName: 'Ahmed' };

  it('needs both names and valid optional fields', () => {
    expect(validateStaff(emptyStaffForm(), true, [])).toMatch(/last name/);
    expect(validateStaff({ ...ok, email: 'nope' }, true, [])).toMatch(/email/);
    expect(validateStaff({ ...ok, dob: '1990' }, true, [])).toMatch(/birth/);
    expect(validateStaff({ ...ok, joined: 'x' }, true, [])).toMatch(/joining/);
    expect(validateStaff(ok, true, [])).toBeNull();
  });

  it('checks the sign-in account only when creating with the switch on', () => {
    const roles = staffAccountRoles(['PRINCIPAL', 'MANAGER', 'TEACHER', 'STAFF']);
    expect(roles).toEqual(['MANAGER', 'TEACHER', 'STAFF']);
    const acct = { ...ok, createAccount: true, username: 'sara', password: 'abcd1234', confirm: 'abcd1234', userRole: 'TEACHER' };
    expect(validateStaff({ ...acct, username: '' }, true, roles)).toMatch(/Username/);
    expect(validateStaff({ ...acct, confirm: 'x' }, true, roles)).toMatch(/match/);
    expect(validateStaff({ ...acct, password: 'short', confirm: 'short' }, true, roles)).toMatch(/8/);
    expect(validateStaff({ ...acct, userRole: 'PRINCIPAL' }, true, roles)).toMatch(/role/);
    expect(validateStaff(acct, true, roles)).toBeNull();
    expect(validateStaff({ ...acct, username: '' }, false, roles)).toBeNull();
  });

  it('sends nulls for empty links and dates, and the account only on create', () => {
    const p = buildStaffPayload(ok, true);
    expect(p).toMatchObject({ first_name: 'Sara', department: null, designation: null, date_of_birth: null, date_of_joining: null, gender: '', employee_id: 'EMP-009' });
    expect(p).not.toHaveProperty('create_user_account');
    const acct = { ...ok, createAccount: true, username: ' sara ', password: 'abcd1234', confirm: 'abcd1234', userRole: 'TEACHER' };
    expect(buildStaffPayload(acct, true)).toMatchObject({ create_user_account: true, username: 'sara', user_role: 'TEACHER', confirm_password: 'abcd1234' });
    expect(buildStaffPayload(acct, false)).not.toHaveProperty('create_user_account');
  });

  it('fills the form from a saved record', () => {
    expect(staffToForm(staff())).toMatchObject({ firstName: 'Ali', department: 2, designation: 5, employeeId: 'EMP-001', createAccount: false });
  });

  it('keeps department and designation consistent', () => {
    const desigs = [{ id: 5, department: 2 }, { id: 6, department: 3 }, { id: 7, department: null }];
    expect(designationsFor(desigs, 2).map((d) => d.id)).toEqual([5]);
    expect(designationsFor(desigs, null)).toHaveLength(3);
    const f = { ...ok, department: 2, designation: 5 };
    expect(withDepartment(f, 3)).toMatchObject({ department: 3, designation: null });
    expect(withDesignation({ ...ok, department: null }, 6, desigs)).toMatchObject({ department: 3, designation: 6 });
    expect(withDesignation({ ...ok, department: 2 }, 6, desigs)).toMatchObject({ department: 2, designation: 6 });
  });
});

describe('departments and designations', () => {
  it('needs a name and trims the payloads', () => {
    expect(validateDepartment(emptyDepartmentForm())).toMatch(/name/);
    expect(buildDepartmentPayload({ name: ' Maths ', description: ' x ', isActive: true })).toEqual({ name: 'Maths', description: 'x', is_active: true });
    expect(buildDesignationPayload({ name: ' Head ', department: 4, isActive: false })).toEqual({ name: 'Head', department: 4, is_active: false });
  });
});

describe('leave policies', () => {
  const ok = { ...emptyLeavePolicyForm(), name: ' Annual 2026 ', days: '14' };

  it('needs a name and whole days', () => {
    expect(validateLeavePolicy(emptyLeavePolicyForm())).toMatch(/name/);
    expect(validateLeavePolicy({ ...ok, days: '' })).toMatch(/whole number/);
    expect(validateLeavePolicy({ ...ok, days: '1.5' })).toMatch(/whole number/);
    expect(validateLeavePolicy({ ...ok, days: '400' })).toMatch(/366/);
    expect(validateLeavePolicy(ok)).toBeNull();
    expect(buildLeavePolicyPayload({ ...ok, carryForward: true })).toEqual({ name: 'Annual 2026', leave_type: 'ANNUAL', days_allowed: 14, carry_forward: true, is_active: true });
  });

  it('describes a policy', () => {
    expect(leavePolicySubtitle({ id: 1, name: 'x', leave_type: 'SICK', days_allowed: 10, carry_forward: true, is_active: true })).toBe('10 days a year  ·  carries forward  ·  Sick leave');
  });
});

describe('documents', () => {
  const ok = { ...emptyDocumentForm(), staff: 3, title: ' CNIC ', fileUri: 'file:///a.jpg', fileName: 'a.jpg', mime: 'image/jpeg' };

  it('needs a person, a title and, on create, a file', () => {
    expect(validateDocument(emptyDocumentForm(), true)).toMatch(/staff member/);
    expect(validateDocument({ ...ok, title: '' }, true)).toMatch(/title/);
    expect(validateDocument({ ...ok, fileUri: null }, true)).toMatch(/photo/);
    expect(validateDocument({ ...ok, fileUri: null }, false)).toBeNull();
    expect(validateDocument({ ...ok, expiry: '2026' }, true)).toMatch(/expiry/);
    expect(validateDocument(ok, true)).toBeNull();
  });

  it('sends the expiry only when set', () => {
    expect(documentFields(ok)).toEqual({ staff_member: '3', document_type: 'ID_DOCUMENT', title: 'CNIC', notes: '' });
    expect(documentFields({ ...ok, expiry: '2027-01-01' })).toHaveProperty('expiry_date', '2027-01-01');
  });

  it('counts the days to expiry', () => {
    expect(daysToExpiry('2026-11-10', '2026-10-30')).toBe(11);
    expect(daysToExpiry('2026-10-29', '2026-10-30')).toBe(-1);
    expect(daysToExpiry(null, '2026-10-30')).toBeNull();
    expect(expiryLabel('2026-10-20', '2026-10-30')).toEqual({ text: 'Expired 10 days ago', tone: 'error' });
    expect(expiryLabel('2026-10-30', '2026-10-30')).toEqual({ text: 'Expires today', tone: 'warning' });
    expect(expiryLabel('2026-11-05', '2026-10-30')).toEqual({ text: 'Expires in 6 days', tone: 'warning' });
    expect(expiryLabel('2027-05-01', '2026-10-30')).toEqual({ text: 'Expires 2027-05-01', tone: 'neutral' });
    expect(expiryLabel(null, '2026-10-30')).toBeNull();
  });
});

describe('qualifications', () => {
  const ok = { ...emptyQualificationForm(4), name: ' BSc ', year: '2018' };

  it('validates and builds the payload', () => {
    expect(validateQualification(emptyQualificationForm(), 2026)).toMatch(/staff member/);
    expect(validateQualification({ ...ok, name: '' }, 2026)).toMatch(/name/);
    expect(validateQualification({ ...ok, year: '18' }, 2026)).toMatch(/year/);
    expect(validateQualification({ ...ok, year: '2090' }, 2026)).toMatch(/year/);
    expect(validateQualification(ok, 2026)).toBeNull();
    expect(buildQualificationPayload(ok)).toMatchObject({ staff_member: 4, qualification_name: 'BSc', year_of_completion: 2018 });
    expect(buildQualificationPayload({ ...ok, year: '' }).year_of_completion).toBeNull();
  });
});

describe('dashboard', () => {
  const stats = (over: Partial<HrStats> = {}): HrStats => ({
    total_staff: 10, active_staff: 9, total_departments: 3, recent_joiners: 1, department_breakdown: [], status_breakdown: [], type_breakdown: [],
    pending_payroll_approvals: 0, pending_leave_applications: 0, staff_on_leave_today: 0, attendance_present_today: 0, attendance_marked_today: 0, ...over,
  });

  it('words today attendance', () => {
    expect(attendanceToday(stats())).toBe('Not marked yet');
    expect(attendanceToday(stats({ attendance_present_today: 7, attendance_marked_today: 9 }))).toBe('7 of 9 present');
  });

  it('lists what needs attention, and nothing when quiet', () => {
    expect(attentionItems(stats())).toEqual([]);
    expect(attentionItems(stats({ pending_leave_applications: 1, pending_payroll_approvals: 3 })).map((i) => i.text)).toEqual([
      '1 leave request waiting for approval', '3 draft payslips this month',
    ]);
  });
});

describe('document file', () => {
  it('accepts what the server accepts and refuses the rest', () => {
    expect(documentFileProblem('application/pdf', 1000)).toBeNull();
    expect(documentFileProblem('IMAGE/JPEG', 1000)).toBeNull();
    expect(documentFileProblem('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 5)).toBeNull();
    expect(documentFileProblem('application/zip', 1000)).toMatch(/PDF/);
    expect(documentFileProblem(null, 1000)).toMatch(/PDF/);
    expect(documentFileProblem('application/pdf', DOCUMENT_MAX_BYTES + 1)).toMatch(/10 MB/);
    expect(documentFileProblem('application/pdf', null)).toBeNull();
  });
});
