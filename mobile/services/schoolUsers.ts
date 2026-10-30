// Users and roles of the active school: port of the Users tab of the web Settings page and its
// ResetPasswordModal. Pure logic, no React Native imports. The server stays the authority on who
// may create, edit or reset whom (users/views.py ROLE_HIERARCHY); this only hides what it would refuse.

export interface SchoolUser {
  id: number;
  username: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  phone?: string | null;
  is_active: boolean;
}

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', SCHOOL_ADMIN: 'School Admin', PRINCIPAL: 'Principal', MANAGER: 'Manager',
  ACCOUNTANT: 'Accountant', TEACHER: 'Teacher', STAFF: 'Staff', DRIVER: 'Driver', STUDENT: 'Student', PARENT: 'Parent',
};

export const roleLabel = (role: string) => ROLE_LABELS[role] ?? role;

// Roles the signed-in person may create or change (same ladder as AuthContext.getAllowableRoles on the web).
export function allowableRoles(role: string | undefined, isSuperAdmin = false): string[] {
  if (isSuperAdmin) return ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER'];
  if (role === 'SCHOOL_ADMIN') return ['PRINCIPAL', 'MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER'];
  if (role === 'PRINCIPAL') return ['MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER'];
  return [];
}

// Roles you can filter the list by: everything but Super Admin, who is not a school-level role.
export const FILTER_ROLES = Object.keys(ROLE_LABELS).filter((r) => r !== 'SUPER_ADMIN');

export const fullName = (u: Pick<SchoolUser, 'first_name' | 'last_name' | 'username'>) =>
  `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.username;

export function filterUsers(users: SchoolUser[], search: string, role: string): SchoolUser[] {
  const term = search.trim().toLowerCase();
  return users.filter((u) => {
    if (role && u.role !== role) return false;
    if (!term) return true;
    return [u.username, u.first_name, u.last_name, u.email].some((v) => (v ?? '').toLowerCase().includes(term));
  });
}

// A person can only change a user whose role they could also hand out.
export const canManageUser = (u: Pick<SchoolUser, 'role'>, allowed: string[]) => allowed.includes(u.role);

export interface UserForm {
  username: string; email: string; password: string; confirm: string;
  firstName: string; lastName: string; role: string; phone: string;
}

export const emptyUserForm = (): UserForm => ({ username: '', email: '', password: '', confirm: '', firstName: '', lastName: '', role: 'STAFF', phone: '' });

export const userToForm = (u: SchoolUser): UserForm => ({
  username: u.username, email: u.email ?? '', password: '', confirm: '', firstName: u.first_name ?? '', lastName: u.last_name ?? '', role: u.role, phone: u.phone ?? '',
});

export const PASSWORD_MIN_LENGTH = 8;

// Same order as the web's usePasswordPolicy: match first, then length.
export function passwordPairProblem(password: string, confirm: string): string | null {
  if (password !== confirm) return "Passwords don't match.";
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUser(f: UserForm, creating: boolean, allowed: string[]): string | null {
  if (creating) {
    if (!f.username.trim()) return 'Enter a username.';
    if (!f.password) return 'Enter a password.';
    const pw = passwordPairProblem(f.password, f.confirm);
    if (pw) return pw;
  }
  if (f.email.trim() && !EMAIL.test(f.email.trim())) return 'Enter a valid email address.';
  if (!allowed.includes(f.role)) return 'Choose a role you are allowed to give.';
  return null;
}

// Create sends the password pair; an edit never touches the password or the username.
export function buildUserPayload(f: UserForm, creating: boolean) {
  const base = {
    email: f.email.trim(), first_name: f.firstName.trim(), last_name: f.lastName.trim(), role: f.role, phone: f.phone.trim(),
  };
  return creating ? { ...base, username: f.username.trim(), password: f.password, confirm_password: f.confirm } : base;
}

export type ResetMode = 'set' | 'email';

export function validateReset(mode: ResetMode, password: string, confirm: string, user: Pick<SchoolUser, 'email'>): string | null {
  if (mode === 'email') return user.email ? null : 'This user has no email on file.';
  if (!password) return 'Enter a new password.';
  return passwordPairProblem(password, confirm);
}

export const buildResetPayload = (mode: ResetMode, password: string, confirm: string) =>
  (mode === 'email' ? { mode } : { mode, new_password: password, confirm_password: confirm });

export function activeToggleText(u: Pick<SchoolUser, 'is_active'>, name: string): { title: string; message: string; confirmLabel: string } {
  return u.is_active
    ? { title: `Deactivate ${name}?`, message: 'They can no longer sign in. Their records are kept.', confirmLabel: 'Deactivate' }
    : { title: `Activate ${name}?`, message: 'They can sign in again.', confirmLabel: 'Activate' };
}
