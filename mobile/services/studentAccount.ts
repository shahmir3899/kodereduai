// A portal login for one existing student: port of ConvertAccountModal.jsx and the rules in
// backend/students/views.py (create_user_account). Pure logic; the server stays the authority.

export const PASSWORD_MIN_LENGTH = 8;

export interface AccountForm { username: string; email: string; password: string; confirm: string }

// "Ayesha Khan" -> "ayesha_khan": lower case, spaces to underscores, anything else dropped.
export const suggestUsername = (name: string | null | undefined): string =>
  (name ?? '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

export const emptyAccountForm = (studentName?: string | null): AccountForm => ({
  username: suggestUsername(studentName), email: '', password: '', confirm: '',
});

// Same order as the web: both fields, then the two passwords matching, then the length.
export function accountProblem(f: AccountForm): string | null {
  if (!f.username.trim() || !f.password) return 'Username and password are required.';
  if (f.password !== f.confirm) return "Passwords don't match.";
  if (f.password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) return 'Enter a valid email, or leave it empty.';
  return null;
}

export function buildAccountPayload(f: AccountForm) {
  return { username: f.username.trim(), email: f.email.trim(), password: f.password, confirm_password: f.confirm };
}

// The server answers 400 with { error } for a taken username, a student who already has a login, and so on.
export function accountErrorText(e: unknown, fallback = 'Could not create the login.'): string {
  const d = (e as { response?: { data?: { error?: string; detail?: string } } })?.response?.data;
  return d?.error || d?.detail || fallback;
}
