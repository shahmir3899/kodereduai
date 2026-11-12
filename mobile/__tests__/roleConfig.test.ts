import { allRoleValues, creatableRoles, roleGroup, roleLabelFromConfig, setRoleConfig } from '../services/roleConfig';
import { ROLE_CONFIG } from './roleFixture';

describe('server-served role config', () => {
  afterEach(() => setRoleConfig(ROLE_CONFIG));

  it('answers from the config the server sent', () => {
    setRoleConfig(ROLE_CONFIG);
    expect(roleLabelFromConfig('MANAGER')).toBe('Manager');
    expect(roleGroup('TEACHER')).toBe('staff');
    expect(roleGroup('PARENT')).toBe('portal');
    expect(creatableRoles('PRINCIPAL')).toEqual(['MANAGER', 'TEACHER', 'STAFF', 'DRIVER']);
    expect(allRoleValues()).not.toContain('FINANCE_MANAGER');
  });

  it('knows nothing (and creates nothing) before the first login', () => {
    setRoleConfig(null);
    expect(roleLabelFromConfig('MANAGER')).toBe('MANAGER');
    expect(creatableRoles('SCHOOL_ADMIN')).toEqual([]);
    expect(roleGroup('MANAGER')).toBeUndefined();
  });
});
