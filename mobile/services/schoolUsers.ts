// Users and roles of the active school: port of the Users tab of the web Settings page and its
// ResetPasswordModal. Pure logic, no React Native imports. The server stays the authority on who
// may create, edit or reset whom (users/views.py ROLE_HIERARCHY); this only hides what it would refuse.

import { allRoleValues, creatableRoles, roleLabelFromConfig } from './roleConfig';

export interface SchoolUser {
  id: number;
  username: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  phone?: string | null;
  is_active: boolean;
  // Managers only: the finance capability that replaced the finance manager role.
  can_manage_finance?: boolean;
}

// Labels and the "who can create whom" ladder come from the server's role list (services/roleConfig).
export const roleLabel = roleLabelFromConfig;

export function allowableRoles(role: string | undefined, isSuperAdmin = false): string[] {
  return creatableRoles(isSuperAdmin ? 'SUPER_ADMIN' : role);
}

// Roles you can filter the list by: everything but Super Admin, who is not a school-level role.
export const filterRoles = () => allRoleValues().filter((r) => r !== 'SUPER_ADMIN');

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
  canManageFinance: boolean;
}

export const emptyUserForm = (): UserForm => ({ username: '', email: '', password: '', confirm: '', firstName: '', lastName: '', role: 'STAFF', phone: '', canManageFinance: false });

export const userToForm = (u: SchoolUser): UserForm => ({
  username: u.username, email: u.email ?? '', password: '', confirm: '', firstName: u.first_name ?? '', lastName: u.last_name ?? '', role: u.role, phone: u.phone ?? '', canManageFinance: !!u.can_manage_finance,
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
    can_manage_finance: f.role === 'MANAGER' && f.canManageFinance,
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
    ? { title: `Deactivate ${name}?`, message: 'They can no longer sign in. This is how a user is removed: the server never erases one, so their attendance, payments and history are kept, and you can activate them again.', confirmLabel: 'Deactivate' }
    : { title: `Activate ${name}?`, message: 'They can sign in again.', confirmLabel: 'Activate' };
}
