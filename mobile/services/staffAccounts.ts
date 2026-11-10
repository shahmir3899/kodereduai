// Sign-in accounts of staff members: create one, link an existing user, unlink, change the role, and
// create several at once. Port of the Staff Directory and Staff form handlers on the web and of
// backend/hr/views.py (create-user-account, link-user-account, unlink-user-account, update-user-role,
// bulk-create-accounts). Pure logic. The server stays the authority on who may give which role.

export const PASSWORD_MIN = 8;

export interface NewAccountForm { username: string; role: string; password: string; confirm: string }

// The web suggests first_last, lower case, letters, digits and underscores only.
export function suggestUsername(first: string | null | undefined, last: string | null | undefined): string {
  return `${first ?? ''}_${last ?? ''}`.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, '');
}

export const emptyAccountForm = (first?: string | null, last?: string | null, role = 'STAFF'): NewAccountForm => ({
  username: suggestUsername(first, last), role, password: '', confirm: '',
});

export function validateNewAccount(f: NewAccountForm, allowed: string[]): string | null {
  if (!f.username.trim()) return 'Enter a username.';
  if (!allowed.includes(f.role)) return 'Choose a role for the account.';
  if (f.password.length < PASSWORD_MIN) return `The password needs ${PASSWORD_MIN} or more characters.`;
  if (f.password !== f.confirm) return 'The two passwords do not match.';
  return null;
}

export const buildAccountPayload = (f: NewAccountForm) => ({
  username: f.username.trim(), password: f.password, confirm_password: f.confirm, user_role: f.role,
});

// ── Link an existing user ─────────────────────────────────────────────────────────────────────

export interface LinkCandidate { id: number; username: string; first_name?: string | null; last_name?: string | null; role?: string; is_active?: boolean }

// Users the person can pick: active, and not already linked to a staff member.
export function linkCandidates(users: LinkCandidate[], linkedUserIds: Array<number | null | undefined>): LinkCandidate[] {
  const linked = new Set(linkedUserIds.filter((x): x is number => typeof x === 'number'));
  return users.filter((u) => u.is_active !== false && !linked.has(u.id));
}

export const candidateLabel = (u: LinkCandidate) => {
  const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
  return name ? `${name} (@${u.username})` : `@${u.username}`;
};

// The web searches from two characters on.
export const canSearchUsers = (term: string) => term.trim().length >= 2;

// ── Role and unlink ───────────────────────────────────────────────────────────────────────────

// Nothing to send when the role is not chosen or is the one already held.
export function roleChangeProblem(current: string | null | undefined, next: string, allowed: string[]): string | null {
  if (!next) return 'Choose a role.';
  if (next === current) return 'That is already their role.';
  if (!allowed.includes(next)) return 'You cannot give that role.';
  return null;
}

export const unlinkText = (username: string, name: string) =>
  `Unlink @${username} from ${name}? The sign-in account is not deleted: the person just stops being linked to this staff record.`;

export const roleChangeText = (name: string, role: string) => `${name} will have the ${role} role from now on, with the access that role has.`;

// The server answers { error } for every refusal on these actions.
export function accountErrorText(e: unknown, fallback: string): string {
  const data = (e as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (data && typeof data === 'object') {
    const msg = data.error ?? data.detail;
    if (typeof msg === 'string' && msg) return msg;
  }
  return (e as { response?: unknown })?.response ? fallback : 'No connection. Check your internet and try again.';
}

// ── Several at once ───────────────────────────────────────────────────────────────────────────

export interface BulkLoginsForm { role: string; password: string }
export const emptyBulkForm = (role = 'TEACHER'): BulkLoginsForm => ({ role, password: '' });

// Staff who can still be given a login: no account yet.
export const needsLogin = <T extends { user?: number | null }>(staff: T[]): T[] => staff.filter((s) => !s.user);

export function validateBulkLogins(ids: number[], f: BulkLoginsForm, allowed: string[]): string | null {
  if (ids.length === 0) return 'Choose at least one staff member.';
  if (!allowed.includes(f.role)) return 'Choose a role for the accounts.';
  if (f.password.length < PASSWORD_MIN) return `The shared password needs ${PASSWORD_MIN} or more characters.`;
  return null;
}

export const buildBulkPayload = (ids: number[], f: BulkLoginsForm) => ({ staff_ids: ids, default_password: f.password, default_role: f.role });

export interface BulkLoginsResult {
  created_count?: number;
  created?: Array<{ staff_id: number; username: string; name: string }>;
  skipped?: Array<{ staff_id: number; name: string; reason: string }>;
  errors?: Array<{ staff_id: number; name: string; error: string }>;
}

export function bulkLoginsSummary(r: BulkLoginsResult | undefined): { headline: string; lines: string[] } {
  const created = r?.created ?? [];
  const n = r?.created_count ?? created.length;
  const lines = [
    ...created.map((c) => `${c.name}: @${c.username}`),
    ...(r?.skipped ?? []).map((s) => `${s.name}: skipped, ${s.reason.toLowerCase()}`),
    ...(r?.errors ?? []).map((x) => `${x.name}: ${x.error}`),
  ];
  return { headline: `${n} account${n === 1 ? '' : 's'} created.`, lines };
}
