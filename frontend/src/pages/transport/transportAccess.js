// Matches the backend's IsSchoolAdminOrReadOnly (core.permissions.ADMIN_ROLES):
// everyone else can open the pages but every write returns 403.
const TRANSPORT_ADMIN_ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL']

export const canManageTransport = (role) => TRANSPORT_ADMIN_ROLES.includes(role)
