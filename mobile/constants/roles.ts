export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SCHOOL_ADMIN: 'SCHOOL_ADMIN',
  PRINCIPAL: 'PRINCIPAL',
  HR_MANAGER: 'HR_MANAGER',
  ACCOUNTANT: 'ACCOUNTANT',
  TEACHER: 'TEACHER',
  STAFF: 'STAFF',
  PARENT: 'PARENT',
  STUDENT: 'STUDENT',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const STAFF_ROLES: Role[] = [
  ROLES.STAFF,
  ROLES.TEACHER,
  ROLES.HR_MANAGER,
  ROLES.ACCOUNTANT,
];

export const ADMIN_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.SCHOOL_ADMIN,
  ROLES.PRINCIPAL,
];

export function isAdminRole(role: string | undefined): boolean {
  return ADMIN_ROLES.includes(role as Role);
}

export function isStaffRole(role: string | undefined): boolean {
  return STAFF_ROLES.includes(role as Role);
}

export function isParentRole(role: string | undefined): boolean {
  return role === ROLES.PARENT;
}

export function isStudentRole(role: string | undefined): boolean {
  return role === ROLES.STUDENT;
}
