// The role list lives on the server (backend core/roles.py) and arrives with the login and /me
// payload. This holds the latest copy so pure helpers (labels, who-can-create-whom) never keep
// their own list. AuthContext calls setRoleConfig whenever it receives a user.

export interface RoleConfig {
  roles: { value: string; label: string; group: 'admin' | 'staff' | 'portal' }[];
  creatable: Record<string, string[]>;
  capabilities: { key: string; label: string }[];
}

let current: RoleConfig | null = null;

export const setRoleConfig = (config: RoleConfig | null | undefined) => {
  current = config ?? null;
};

export const getRoleConfig = () => current;

export const roleLabelFromConfig = (role: string) =>
  current?.roles.find((r) => r.value === role)?.label ?? role;

export const roleGroup = (role: string | undefined) =>
  current?.roles.find((r) => r.value === role)?.group;

export const creatableRoles = (role: string | undefined) => (role && current?.creatable[role]) || [];

export const allRoleValues = () => (current?.roles ?? []).map((r) => r.value);
