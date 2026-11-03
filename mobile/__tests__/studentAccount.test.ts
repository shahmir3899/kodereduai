import {
  accountErrorText, accountProblem, buildAccountPayload, emptyAccountForm, PASSWORD_MIN_LENGTH, suggestUsername, type AccountForm,
} from '../services/studentAccount';

const ok: AccountForm = { username: 'ayesha_khan', email: '', password: 'longenough1', confirm: 'longenough1' };

describe('suggestUsername', () => {
  it('lower-cases, joins words with underscores and drops other characters', () => {
    expect(suggestUsername('Ayesha Khan')).toBe('ayesha_khan');
    expect(suggestUsername("  Muhammad  O'Brien-Ali ")).toBe('_muhammad_obrienali_');
    expect(suggestUsername('Zoë 7')).toBe('zo_7');
  });

  it('is empty for a missing name', () => {
    expect(suggestUsername(null)).toBe('');
    expect(suggestUsername(undefined)).toBe('');
    expect(suggestUsername('')).toBe('');
  });

  it('fills a new form from the student name', () => {
    expect(emptyAccountForm('Ayesha Khan')).toEqual({ username: 'ayesha_khan', email: '', password: '', confirm: '' });
  });
});

describe('accountProblem', () => {
  it('accepts a complete form', () => {
    expect(accountProblem(ok)).toBeNull();
    expect(accountProblem({ ...ok, email: 'a@school.pk' })).toBeNull();
  });

  it('needs a username and a password', () => {
    expect(accountProblem({ ...ok, username: '  ' })).toBe('Username and password are required.');
    expect(accountProblem({ ...ok, password: '', confirm: '' })).toBe('Username and password are required.');
  });

  it('checks the two passwords match before the length, as the web does', () => {
    expect(accountProblem({ ...ok, confirm: 'different1' })).toBe("Passwords don't match.");
    expect(accountProblem({ ...ok, password: 'short', confirm: 'short' })).toBe(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    expect(accountProblem({ ...ok, password: 'short', confirm: 'other' })).toBe("Passwords don't match.");
  });

  it('accepts exactly the minimum length', () => {
    const eight = 'a'.repeat(PASSWORD_MIN_LENGTH);
    expect(accountProblem({ ...ok, password: eight, confirm: eight })).toBeNull();
  });

  it('rejects an email that is not one, but lets it be empty', () => {
    expect(accountProblem({ ...ok, email: 'not-an-email' })).toBe('Enter a valid email, or leave it empty.');
    expect(accountProblem({ ...ok, email: '   ' })).toBeNull();
  });
});

describe('the request', () => {
  it('trims the username and email and sends the confirmation the server expects', () => {
    expect(buildAccountPayload({ ...ok, username: ' ayesha_khan ', email: ' a@school.pk ' })).toEqual({
      username: 'ayesha_khan', email: 'a@school.pk', password: 'longenough1', confirm_password: 'longenough1',
    });
  });
});

describe('accountErrorText', () => {
  it('shows what the server said, error first then detail', () => {
    expect(accountErrorText({ response: { data: { error: 'This username is already taken.' } } })).toBe('This username is already taken.');
    expect(accountErrorText({ response: { data: { detail: 'Not allowed.' } } })).toBe('Not allowed.');
  });

  it('falls back when there is no server message', () => {
    expect(accountErrorText(new Error('Network Error'))).toBe('Could not create the login.');
    expect(accountErrorText({ response: { data: {} } }, 'Try again.')).toBe('Try again.');
    expect(accountErrorText(null)).toBe('Could not create the login.');
  });
});
