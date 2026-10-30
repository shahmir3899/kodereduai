import {
  activeToggleText, allowableRoles, buildResetPayload, buildUserPayload, canManageUser, emptyUserForm, filterUsers, fullName,
  passwordPairProblem, roleLabel, userToForm, validateReset, validateUser, type SchoolUser,
} from '../services/schoolUsers';

const u = (over: Partial<SchoolUser> = {}): SchoolUser => ({ id: 1, username: 'ali', first_name: 'Ali', last_name: 'Khan', email: 'ali@x.pk', role: 'TEACHER', is_active: true, ...over });

describe('roles', () => {
  it('follows the role ladder', () => {
    expect(allowableRoles('SCHOOL_ADMIN')).toEqual(['PRINCIPAL', 'MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER']);
    expect(allowableRoles('PRINCIPAL')).not.toContain('PRINCIPAL');
    expect(allowableRoles('TEACHER')).toEqual([]);
    expect(allowableRoles('SCHOOL_ADMIN', true)).toContain('SUPER_ADMIN');
  });

  it('labels roles and falls back to the code', () => {
    expect(roleLabel('SCHOOL_ADMIN')).toBe('School Admin');
    expect(roleLabel('X')).toBe('X');
  });

  it('only lets a person manage users of roles they can give', () => {
    const allowed = allowableRoles('PRINCIPAL');
    expect(canManageUser(u({ role: 'TEACHER' }), allowed)).toBe(true);
    expect(canManageUser(u({ role: 'SCHOOL_ADMIN' }), allowed)).toBe(false);
  });
});

describe('list', () => {
  const users = [u(), u({ id: 2, username: 'sara', first_name: 'Sara', last_name: null, email: null, role: 'STAFF' })];

  it('searches name, username and email, and filters by role', () => {
    expect(filterUsers(users, 'khan', '').map((x) => x.id)).toEqual([1]);
    expect(filterUsers(users, 'SARA', '').map((x) => x.id)).toEqual([2]);
    expect(filterUsers(users, 'x.pk', '').map((x) => x.id)).toEqual([1]);
    expect(filterUsers(users, '', 'STAFF').map((x) => x.id)).toEqual([2]);
    expect(filterUsers(users, '', '')).toHaveLength(2);
  });

  it('shows the username when there is no name', () => {
    expect(fullName(u({ first_name: '', last_name: null }))).toBe('ali');
    expect(fullName(u())).toBe('Ali Khan');
  });
});

describe('form', () => {
  const allowed = allowableRoles('SCHOOL_ADMIN');
  const ok = { ...emptyUserForm(), username: ' newuser ', password: 'abcd1234', confirm: 'abcd1234', role: 'TEACHER' };

  it('needs a username, a matching password of 8+ and a role you may give when creating', () => {
    expect(validateUser(emptyUserForm(), true, allowed)).toMatch(/username/);
    expect(validateUser({ ...ok, password: '' }, true, allowed)).toMatch(/password/);
    expect(validateUser({ ...ok, confirm: 'nope' }, true, allowed)).toMatch(/match/);
    expect(validateUser({ ...ok, password: 'short', confirm: 'short' }, true, allowed)).toMatch(/at least 8/);
    expect(validateUser({ ...ok, email: 'bad' }, true, allowed)).toMatch(/email/);
    expect(validateUser({ ...ok, role: 'SCHOOL_ADMIN' }, true, allowed)).toMatch(/role/);
    expect(validateUser(ok, true, allowed)).toBeNull();
  });

  it('ignores the password and username when editing', () => {
    expect(validateUser({ ...emptyUserForm(), role: 'STAFF' }, false, allowed)).toBeNull();
    expect(buildUserPayload({ ...ok, firstName: ' A ' }, false)).toEqual({ email: '', first_name: 'A', last_name: '', role: 'TEACHER', phone: '' });
  });

  it('sends the password pair only on create', () => {
    expect(buildUserPayload(ok, true)).toMatchObject({ username: 'newuser', password: 'abcd1234', confirm_password: 'abcd1234' });
    expect(userToForm(u())).toMatchObject({ username: 'ali', password: '', firstName: 'Ali', role: 'TEACHER' });
  });

  it('checks the password pair like the web policy: match first', () => {
    expect(passwordPairProblem('a', 'b')).toMatch(/match/);
    expect(passwordPairProblem('abc', 'abc')).toMatch(/at least 8/);
    expect(passwordPairProblem('abcd1234', 'abcd1234')).toBeNull();
  });
});

describe('reset password', () => {
  it('needs an email on file to send a link, and a valid pair to set one', () => {
    expect(validateReset('email', '', '', { email: null })).toMatch(/no email/);
    expect(validateReset('email', '', '', { email: 'a@b.pk' })).toBeNull();
    expect(validateReset('set', '', '', { email: null })).toMatch(/new password/);
    expect(validateReset('set', 'abcd1234', 'abcd1235', { email: null })).toMatch(/match/);
    expect(validateReset('set', 'abcd1234', 'abcd1234', { email: null })).toBeNull();
  });

  it('builds the payload for each mode', () => {
    expect(buildResetPayload('email', 'x', 'y')).toEqual({ mode: 'email' });
    expect(buildResetPayload('set', 'abcd1234', 'abcd1234')).toEqual({ mode: 'set', new_password: 'abcd1234', confirm_password: 'abcd1234' });
  });

  it('words the active toggle', () => {
    expect(activeToggleText(u(), 'Ali').confirmLabel).toBe('Deactivate');
    expect(activeToggleText(u({ is_active: false }), 'Ali').confirmLabel).toBe('Activate');
  });
});
