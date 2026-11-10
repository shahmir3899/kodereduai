import {
  accountErrorText, buildAccountPayload, buildBulkPayload, bulkLoginsSummary, candidateLabel, canSearchUsers, emptyAccountForm, emptyBulkForm,
  linkCandidates, needsLogin, roleChangeProblem, suggestUsername, unlinkText, validateBulkLogins, validateNewAccount,
} from '../services/staffAccounts';

const ALLOWED = ['MANAGER', 'TEACHER', 'STAFF'];

describe('suggesting a username', () => {
  it('joins the names in lower case, with underscores', () => {
    expect(suggestUsername('Sara', 'Khan')).toBe('sara_khan');
    expect(suggestUsername('Mary Ann', "O'Neil")).toBe('mary_ann_oneil');
    expect(suggestUsername('Ali', '')).toBe('ali');
    expect(suggestUsername(null, undefined)).toBe('');
  });
});

describe('a new account', () => {
  const ok = { ...emptyAccountForm('Sara', 'Khan', 'TEACHER'), password: 'longenough', confirm: 'longenough' };
  it('starts from the suggested username and the given role', () => {
    expect(emptyAccountForm('Sara', 'Khan', 'TEACHER')).toMatchObject({ username: 'sara_khan', role: 'TEACHER' });
  });
  it('accepts a complete form', () => { expect(validateNewAccount(ok, ALLOWED)).toBeNull(); });
  it('asks for each missing piece', () => {
    expect(validateNewAccount({ ...ok, username: ' ' }, ALLOWED)).toMatch(/username/i);
    expect(validateNewAccount({ ...ok, role: 'SCHOOL_ADMIN' }, ALLOWED)).toMatch(/role/i);
    expect(validateNewAccount({ ...ok, password: 'short', confirm: 'short' }, ALLOWED)).toMatch(/8 or more/);
    expect(validateNewAccount({ ...ok, confirm: 'different1' }, ALLOWED)).toMatch(/do not match/);
  });
  it('sends what the server reads', () => {
    expect(buildAccountPayload({ ...ok, username: ' sara_khan ' })).toEqual({ username: 'sara_khan', password: 'longenough', confirm_password: 'longenough', user_role: 'TEACHER' });
  });
});

describe('linking an existing user', () => {
  const users = [{ id: 1, username: 'a' }, { id: 2, username: 'b', is_active: false }, { id: 3, username: 'c', first_name: 'Cara', last_name: 'Lee' }];
  it('offers active users who are not linked to another staff member', () => {
    expect(linkCandidates(users, [1, null, undefined]).map((u) => u.id)).toEqual([3]);
    expect(linkCandidates(users, []).map((u) => u.id)).toEqual([1, 3]);
  });
  it('labels a user by name and username, or username alone', () => {
    expect(candidateLabel(users[2])).toBe('Cara Lee (@c)');
    expect(candidateLabel(users[0])).toBe('@a');
  });
  it('searches from two letters', () => {
    expect(canSearchUsers('a')).toBe(false);
    expect(canSearchUsers(' ab ')).toBe(true);
  });
});

describe('changing the role and unlinking', () => {
  it('refuses an empty choice, the same role and a role above yours', () => {
    expect(roleChangeProblem('TEACHER', '', ALLOWED)).toMatch(/choose/i);
    expect(roleChangeProblem('TEACHER', 'TEACHER', ALLOWED)).toMatch(/already/);
    expect(roleChangeProblem('TEACHER', 'PRINCIPAL', ALLOWED)).toMatch(/cannot/);
    expect(roleChangeProblem('TEACHER', 'MANAGER', ALLOWED)).toBeNull();
  });
  it('says the account is kept when unlinking', () => {
    expect(unlinkText('sara', 'Sara Khan')).toMatch(/@sara.*Sara Khan.*not deleted/);
  });
  it('reads the server error, else a fallback, else a connection message', () => {
    expect(accountErrorText({ response: { data: { error: 'This username is already taken.' } } }, 'x')).toBe('This username is already taken.');
    expect(accountErrorText({ response: { data: { detail: 'Nope' } } }, 'x')).toBe('Nope');
    expect(accountErrorText({ response: { data: {} } }, 'fallback')).toBe('fallback');
    expect(accountErrorText(new Error('Network Error'), 'fallback')).toMatch(/connection/i);
  });
});

describe('several logins at once', () => {
  it('lists only staff without an account', () => {
    expect(needsLogin([{ user: null }, { user: 5 }, {}]).length).toBe(2);
  });
  it('needs people, a role and a password', () => {
    const f = { ...emptyBulkForm('TEACHER'), password: 'longenough' };
    expect(validateBulkLogins([], f, ALLOWED)).toMatch(/at least one/);
    expect(validateBulkLogins([1], { ...f, role: 'PRINCIPAL' }, ALLOWED)).toMatch(/role/);
    expect(validateBulkLogins([1], { ...f, password: 'short' }, ALLOWED)).toMatch(/8 or more/);
    expect(validateBulkLogins([1, 2], f, ALLOWED)).toBeNull();
    expect(buildBulkPayload([1, 2], f)).toEqual({ staff_ids: [1, 2], default_password: 'longenough', default_role: 'TEACHER' });
  });
  it('sums up what was made, skipped and refused', () => {
    const s = bulkLoginsSummary({
      created_count: 1, created: [{ staff_id: 1, username: 'sara_khan', name: 'Sara Khan' }],
      skipped: [{ staff_id: 2, name: 'Ali', reason: 'Already has account' }], errors: [{ staff_id: 3, name: 'Zed', error: 'Could not generate unique username' }],
    });
    expect(s.headline).toBe('1 account created.');
    expect(s.lines).toEqual(['Sara Khan: @sara_khan', 'Ali: skipped, already has account', 'Zed: Could not generate unique username']);
    expect(bulkLoginsSummary(undefined).headline).toBe('0 accounts created.');
  });
});
