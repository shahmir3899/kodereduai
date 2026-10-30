// HR directory for admin and principal: staff create and edit, departments and designations, leave
// policies, staff documents and qualifications, and the dashboard numbers. Port of the web pages
// under frontend/src/pages/hr. Pure logic, no React Native imports.

// ─── Staff ─────────────────────────────────────────────────────────────────────────────────

export interface StaffRow {
  id: number;
  full_name: string;
  first_name?: string;
  last_name?: string;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  department?: number | null;
  department_name?: string | null;
  designation?: number | null;
  designation_name?: string | null;
  employee_id?: string | null;
  employment_type?: string;
  employment_status?: string;
  date_of_joining?: string | null;
  address?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  notes?: string | null;
  is_active?: boolean;
  user?: number | null;
  user_username?: string | null;
  user_role?: string | null;
}

export const GENDERS = [{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }, { value: 'OTHER', label: 'Other' }];
export const EMPLOYMENT_TYPES = [
  { value: 'FULL_TIME', label: 'Full time' }, { value: 'PART_TIME', label: 'Part time' }, { value: 'CONTRACT', label: 'Contract' },
  { value: 'TEMPORARY', label: 'Temporary' }, { value: 'INTERN', label: 'Intern' },
];
export const EMPLOYMENT_STATUSES = [
  { value: 'ACTIVE', label: 'Active' }, { value: 'ON_LEAVE', label: 'On leave' }, { value: 'TERMINATED', label: 'Terminated' },
  { value: 'RESIGNED', label: 'Resigned' }, { value: 'RETIRED', label: 'Retired' },
];

export const labelOf = (list: Array<{ value: string; label: string }>, value: string | null | undefined) =>
  list.find((o) => o.value === value)?.label ?? (value || '');

// Statuses that mean the person no longer works here (the list greys them out).
export const LEFT_STATUSES = new Set(['TERMINATED', 'RESIGNED', 'RETIRED']);
export const staffHasLeft = (s: Pick<StaffRow, 'employment_status' | 'is_active'>) =>
  s.is_active === false || LEFT_STATUSES.has(s.employment_status ?? '');

// The list API answers with full_name and department_name; the old screen read name and department
// and showed blanks.
export const staffSubtitle = (s: StaffRow) => [s.designation_name, s.department_name].filter(Boolean).join('  ·  ');

export interface StaffForm {
  firstName: string; lastName: string; email: string; phone: string; gender: string; dob: string;
  department: number | null; designation: number | null; employeeId: string;
  employmentType: string; employmentStatus: string; joined: string;
  address: string; emergencyName: string; emergencyPhone: string; notes: string;
  // Optional sign-in account, create only.
  createAccount: boolean; username: string; password: string; confirm: string; userRole: string;
}

export const emptyStaffForm = (nextEmployeeId = ''): StaffForm => ({
  firstName: '', lastName: '', email: '', phone: '', gender: '', dob: '', department: null, designation: null, employeeId: nextEmployeeId,
  employmentType: 'FULL_TIME', employmentStatus: 'ACTIVE', joined: '', address: '', emergencyName: '', emergencyPhone: '', notes: '',
  createAccount: false, username: '', password: '', confirm: '', userRole: 'STAFF',
});

export const staffToForm = (s: StaffRow): StaffForm => ({
  ...emptyStaffForm(s.employee_id ?? ''),
  firstName: s.first_name ?? '', lastName: s.last_name ?? '', email: s.email ?? '', phone: s.phone ?? '', gender: s.gender ?? '',
  dob: s.date_of_birth ?? '', department: s.department ?? null, designation: s.designation ?? null,
  employmentType: s.employment_type || 'FULL_TIME', employmentStatus: s.employment_status || 'ACTIVE', joined: s.date_of_joining ?? '',
  address: s.address ?? '', emergencyName: s.emergency_contact_name ?? '', emergencyPhone: s.emergency_contact_phone ?? '', notes: s.notes ?? '',
});

// Roles a staff member's sign-in may have: the web hides the three admin-level ones here.
export const STAFF_ACCOUNT_ROLES = ['MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER'];
export const staffAccountRoles = (allowed: string[]) => allowed.filter((r) => STAFF_ACCOUNT_ROLES.includes(r));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateStaff(f: StaffForm, creating: boolean, accountRoles: string[]): string | null {
  if (!f.firstName.trim() || !f.lastName.trim()) return 'First name and last name are required.';
  if (f.email.trim() && !EMAIL.test(f.email.trim())) return 'Enter a valid email address.';
  if (f.dob && !DATE.test(f.dob)) return 'Choose the date of birth.';
  if (f.joined && !DATE.test(f.joined)) return 'Choose the joining date.';
  if (creating && f.createAccount) {
    if (!f.username.trim() || !f.password) return 'Username and password are required for the sign-in account.';
    if (f.password !== f.confirm) return "Passwords don't match.";
    if (f.password.length < 8) return 'Password must be at least 8 characters.';
    if (!accountRoles.includes(f.userRole)) return 'Choose a role for the sign-in account.';
  }
  return null;
}

// Empty choices go as null (the API rejects '' for a date or a link). Gender stays a string: the
// column does not accept null.
export function buildStaffPayload(f: StaffForm, creating: boolean) {
  const base: Record<string, unknown> = {
    first_name: f.firstName.trim(), last_name: f.lastName.trim(), email: f.email.trim(), phone: f.phone.trim(), gender: f.gender,
    date_of_birth: f.dob || null, department: f.department, designation: f.designation, employee_id: f.employeeId.trim(),
    employment_type: f.employmentType, employment_status: f.employmentStatus, date_of_joining: f.joined || null,
    address: f.address.trim(), emergency_contact_name: f.emergencyName.trim(), emergency_contact_phone: f.emergencyPhone.trim(), notes: f.notes.trim(),
  };
  if (creating && f.createAccount) {
    Object.assign(base, { create_user_account: true, username: f.username.trim(), password: f.password, confirm_password: f.confirm, user_role: f.userRole });
  }
  return base;
}

// Designations offered for the chosen department (all of them when none is chosen).
export function designationsFor<T extends { department?: number | null }>(designations: T[], department: number | null): T[] {
  return department == null ? designations : designations.filter((d) => d.department === department);
}

// Choosing a designation first fills in its department; changing the department clears a designation
// that belongs elsewhere (same behaviour as the web form).
export function withDepartment(f: StaffForm, department: number | null): StaffForm {
  return { ...f, department, designation: null };
}
export function withDesignation(f: StaffForm, designation: number | null, designations: Array<{ id: number; department?: number | null }>): StaffForm {
  const dept = designations.find((d) => d.id === designation)?.department ?? null;
  return { ...f, designation, department: f.department ?? dept };
}

// ─── Departments and designations ──────────────────────────────────────────────────────────

export interface Department { id: number; name: string; description?: string | null; is_active: boolean; staff_count?: number }
export interface Designation { id: number; name: string; department?: number | null; department_name?: string | null; is_active: boolean }

export interface DepartmentForm { name: string; description: string; isActive: boolean }
export const emptyDepartmentForm = (): DepartmentForm => ({ name: '', description: '', isActive: true });
export const departmentToForm = (d: Department): DepartmentForm => ({ name: d.name, description: d.description ?? '', isActive: d.is_active });
export const validateDepartment = (f: DepartmentForm) => (f.name.trim() ? null : 'Enter the department name.');
export const buildDepartmentPayload = (f: DepartmentForm) => ({ name: f.name.trim(), description: f.description.trim(), is_active: f.isActive });

export interface DesignationForm { name: string; department: number | null; isActive: boolean }
export const emptyDesignationForm = (department: number | null = null): DesignationForm => ({ name: '', department, isActive: true });
export const designationToForm = (d: Designation): DesignationForm => ({ name: d.name, department: d.department ?? null, isActive: d.is_active });
export const validateDesignation = (f: DesignationForm) => (f.name.trim() ? null : 'Enter the designation name.');
export const buildDesignationPayload = (f: DesignationForm) => ({ name: f.name.trim(), department: f.department, is_active: f.isActive });

// ─── Leave policies ────────────────────────────────────────────────────────────────────────

export interface LeavePolicy { id: number; name: string; leave_type: string; leave_type_display?: string; days_allowed: number; carry_forward: boolean; is_active: boolean; applications_count?: number }

export const LEAVE_TYPES = [
  { value: 'ANNUAL', label: 'Annual leave' }, { value: 'SICK', label: 'Sick leave' }, { value: 'CASUAL', label: 'Casual leave' },
  { value: 'MATERNITY', label: 'Maternity leave' }, { value: 'UNPAID', label: 'Unpaid leave' }, { value: 'OTHER', label: 'Other' },
];

export interface LeavePolicyForm { name: string; leaveType: string; days: string; carryForward: boolean; isActive: boolean }
export const emptyLeavePolicyForm = (): LeavePolicyForm => ({ name: '', leaveType: 'ANNUAL', days: '', carryForward: false, isActive: true });
export const leavePolicyToForm = (p: LeavePolicy): LeavePolicyForm => ({ name: p.name, leaveType: p.leave_type, days: String(p.days_allowed), carryForward: p.carry_forward, isActive: p.is_active });

export function validateLeavePolicy(f: LeavePolicyForm): string | null {
  if (!f.name.trim()) return 'Enter the policy name.';
  if (!/^\d+$/.test(f.days.trim())) return 'Enter the days allowed per year as a whole number.';
  if (Number(f.days) > 366) return 'Days allowed cannot be more than 366.';
  return null;
}

export const buildLeavePolicyPayload = (f: LeavePolicyForm) => ({
  name: f.name.trim(), leave_type: f.leaveType, days_allowed: Number(f.days), carry_forward: f.carryForward, is_active: f.isActive,
});

export const leavePolicySubtitle = (p: LeavePolicy) =>
  [`${p.days_allowed} days a year`, p.carry_forward ? 'carries forward' : null, labelOf(LEAVE_TYPES, p.leave_type)].filter(Boolean).join('  ·  ');

// ─── Documents and qualifications ──────────────────────────────────────────────────────────

export const DOCUMENT_TYPES = [
  { value: 'ID_DOCUMENT', label: 'ID document' }, { value: 'CONTRACT', label: 'Contract' }, { value: 'CERTIFICATE', label: 'Certificate' },
  { value: 'MEDICAL', label: 'Medical certificate' }, { value: 'OTHER', label: 'Other' },
];
export const QUALIFICATION_TYPES = [
  { value: 'DEGREE', label: 'Degree' }, { value: 'DIPLOMA', label: 'Diploma' }, { value: 'CERTIFICATION', label: 'Certification' },
  { value: 'TRAINING', label: 'Training' }, { value: 'LICENSE', label: 'License' },
];

export interface StaffDocument {
  id: number; staff_member: number; staff_member_name?: string; document_type: string; document_type_display?: string;
  title: string; file_url?: string | null; notes?: string | null; expiry_date?: string | null; uploaded_at?: string;
}

export interface DocumentForm { staff: number | null; type: string; title: string; notes: string; expiry: string; fileUri: string | null; fileName: string | null; mime: string | null }
export const emptyDocumentForm = (): DocumentForm => ({ staff: null, type: 'ID_DOCUMENT', title: '', notes: '', expiry: '', fileUri: null, fileName: null, mime: null });
export const documentToForm = (d: StaffDocument): DocumentForm => ({
  staff: d.staff_member, type: d.document_type, title: d.title, notes: d.notes ?? '', expiry: d.expiry_date ?? '', fileUri: null, fileName: null, mime: null,
});

// What the server accepts for a staff document (core/storage.py): PDF, JPG, PNG, WEBP, DOC, DOCX, up to 10 MB.
export const DOCUMENT_MIME_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export function documentFileProblem(mime: string | null | undefined, size: number | null | undefined): string | null {
  if (!mime || !DOCUMENT_MIME_TYPES.includes(mime.toLowerCase())) return 'Choose a PDF, a photo (JPG, PNG, WEBP) or a Word file.';
  if (size != null && size > DOCUMENT_MAX_BYTES) return 'The file is too large. The limit is 10 MB.';
  return null;
}

// A new document needs its file (the server refuses one without); an edit may keep the old file.
export function validateDocument(f: DocumentForm, creating: boolean): string | null {
  if (f.staff == null) return 'Choose the staff member.';
  if (!f.title.trim()) return 'Enter a title.';
  if (f.expiry && !DATE.test(f.expiry)) return 'Choose the expiry date.';
  if (creating && !f.fileUri) return 'Choose or take a photo of the document, or pick a PDF.';
  return null;
}

// Multipart fields in the order the server reads them; the file part is added by the caller
// because it is a React Native file object, not a string.
export function documentFields(f: DocumentForm): Record<string, string> {
  return {
    staff_member: String(f.staff), document_type: f.type, title: f.title.trim(), notes: f.notes.trim(), ...(f.expiry ? { expiry_date: f.expiry } : {}),
  };
}

// Days until a document expires; negative once it has. null when it has no expiry.
export function daysToExpiry(expiry: string | null | undefined, today: string): number | null {
  if (!expiry) return null;
  const ms = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((ms(expiry) - ms(today)) / 86_400_000);
}

export function expiryLabel(expiry: string | null | undefined, today: string): { text: string; tone: 'neutral' | 'warning' | 'error' } | null {
  const d = daysToExpiry(expiry, today);
  if (d == null) return null;
  if (d < 0) return { text: `Expired ${-d} day${d === -1 ? '' : 's'} ago`, tone: 'error' };
  if (d <= 30) return { text: d === 0 ? 'Expires today' : `Expires in ${d} day${d === 1 ? '' : 's'}`, tone: 'warning' };
  return { text: `Expires ${expiry}`, tone: 'neutral' };
}

export interface Qualification {
  id: number; staff_member: number; qualification_type: string; qualification_type_display?: string;
  qualification_name: string; institution?: string | null; year_of_completion?: number | null; grade_or_percentage?: string | null;
}

export interface QualificationForm { staff: number | null; type: string; name: string; institution: string; year: string; grade: string }
export const emptyQualificationForm = (staff: number | null = null): QualificationForm => ({ staff, type: 'DEGREE', name: '', institution: '', year: '', grade: '' });
export const qualificationToForm = (q: Qualification): QualificationForm => ({
  staff: q.staff_member, type: q.qualification_type, name: q.qualification_name, institution: q.institution ?? '',
  year: q.year_of_completion == null ? '' : String(q.year_of_completion), grade: q.grade_or_percentage ?? '',
});

export function validateQualification(f: QualificationForm, thisYear: number): string | null {
  if (f.staff == null) return 'Choose the staff member.';
  if (!f.name.trim()) return 'Enter the qualification name.';
  if (f.year.trim() && (!/^\d{4}$/.test(f.year.trim()) || Number(f.year) < 1950 || Number(f.year) > thisYear + 1)) return 'Enter a valid year, for example 2018.';
  return null;
}

export const buildQualificationPayload = (f: QualificationForm) => ({
  staff_member: f.staff, qualification_type: f.type, qualification_name: f.name.trim(), institution: f.institution.trim(),
  year_of_completion: f.year.trim() ? Number(f.year) : null, grade_or_percentage: f.grade.trim(),
});

// ─── Dashboard ─────────────────────────────────────────────────────────────────────────────

export interface HrStats {
  total_staff: number; active_staff: number; total_departments: number; recent_joiners: number;
  department_breakdown: Array<{ department__id: number; department__name: string; count: number }>;
  status_breakdown: Array<{ employment_status: string; count: number }>;
  type_breakdown: Array<{ employment_type: string; count: number }>;
  pending_payroll_approvals: number; pending_leave_applications: number; staff_on_leave_today: number;
  attendance_present_today: number; attendance_marked_today: number;
}

export function attendanceToday(s: Pick<HrStats, 'attendance_present_today' | 'attendance_marked_today'>): string {
  if (!s.attendance_marked_today) return 'Not marked yet';
  return `${s.attendance_present_today} of ${s.attendance_marked_today} present`;
}

// Things that need a person, most urgent first; empty when all is quiet.
export function attentionItems(s: HrStats): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  if (s.pending_leave_applications > 0) out.push({ key: 'leave', text: `${s.pending_leave_applications} leave request${s.pending_leave_applications === 1 ? '' : 's'} waiting for approval` });
  if (s.pending_payroll_approvals > 0) out.push({ key: 'payroll', text: `${s.pending_payroll_approvals} draft payslip${s.pending_payroll_approvals === 1 ? '' : 's'} this month` });
  return out;
}
