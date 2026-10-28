// Which route group a role lands in. SUPER_ADMIN/SCHOOL_ADMIN/PRINCIPAL share one
// shell because the web gives them the same sidebar (isSchoolAdminNav).
export type Persona =
  | 'admin'
  | 'teacher'
  | 'manager'
  | 'accountant'
  | 'staff'
  | 'parent'
  | 'student'
  | 'driver';

export function personaFor(role: string | undefined, isSuperAdmin = false): Persona {
  if (isSuperAdmin) return 'admin';
  switch (role) {
    case 'SUPER_ADMIN':
    case 'SCHOOL_ADMIN':
    case 'PRINCIPAL':
      return 'admin';
    case 'TEACHER':
      return 'teacher';
    case 'MANAGER':
      return 'manager';
    case 'ACCOUNTANT':
      return 'accountant';
    case 'STAFF':
      return 'staff';
    case 'PARENT':
      return 'parent';
    case 'STUDENT':
      return 'student';
    case 'DRIVER':
      return 'driver';
    default:
      // Unknown role: the least-privileged staff shell rather than the admin one.
      return 'staff';
  }
}

export function homeRouteFor(persona: Persona): string {
  return `/(${persona})/dashboard`;
}
