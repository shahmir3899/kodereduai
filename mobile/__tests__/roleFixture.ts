import { setRoleConfig, type RoleConfig } from '../services/roleConfig';

// Same shape the backend sends (core/roles.py role_config()).
export const ROLE_CONFIG: RoleConfig = {
  roles: [
    { value: 'SUPER_ADMIN', label: 'Super Admin', group: 'admin' },
    { value: 'SCHOOL_ADMIN', label: 'School Admin', group: 'admin' },
    { value: 'PRINCIPAL', label: 'Principal', group: 'admin' },
    { value: 'MANAGER', label: 'Manager', group: 'staff' },
    { value: 'TEACHER', label: 'Teacher', group: 'staff' },
    { value: 'STAFF', label: 'Staff', group: 'staff' },
    { value: 'DRIVER', label: 'Driver', group: 'staff' },
    { value: 'PARENT', label: 'Parent', group: 'portal' },
    { value: 'STUDENT', label: 'Student', group: 'portal' },
  ],
  creatable: {
    SUPER_ADMIN: ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'MANAGER', 'TEACHER', 'STAFF', 'DRIVER'],
    SCHOOL_ADMIN: ['PRINCIPAL', 'MANAGER', 'TEACHER', 'STAFF', 'DRIVER'],
    PRINCIPAL: ['MANAGER', 'TEACHER', 'STAFF', 'DRIVER'],
  },
  capabilities: [{ key: 'can_manage_finance', label: 'Finance and fees' }],
};

export const useRoleConfig = () => setRoleConfig(ROLE_CONFIG);
