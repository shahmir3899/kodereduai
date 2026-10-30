import { isAuthEndpoint, loginErrorMessage, MOBILE_CLIENT_HEADERS, refreshEndsSession, tokensFromRefresh } from '../services/sessionRules';

describe('refreshEndsSession', () => {
  it('ends the session when the refresh token is rejected', () => {
    expect(refreshEndsSession({ response: { status: 401 } })).toBe(true);
    expect(refreshEndsSession({ response: { status: 400 } })).toBe(true);
    expect(refreshEndsSession({ response: { status: 403 } })).toBe(true);
  });

  it('keeps the session when the refresh call never reached the server', () => {
    expect(refreshEndsSession({})).toBe(false);
    expect(refreshEndsSession(null)).toBe(false);
  });

  it('keeps the session on a server error', () => {
    expect(refreshEndsSession({ response: { status: 502 } })).toBe(false);
    expect(refreshEndsSession({ response: { status: 500 } })).toBe(false);
  });
});

describe('isAuthEndpoint', () => {
  it('skips refresh for login and refresh itself', () => {
    expect(isAuthEndpoint('/api/auth/login/')).toBe(true);
    expect(isAuthEndpoint('/api/auth/refresh/')).toBe(true);
    expect(isAuthEndpoint('/api/parents/register/')).toBe(true);
  });

  it('does not skip ordinary calls', () => {
    expect(isAuthEndpoint('/api/auth/me/')).toBe(false);
    expect(isAuthEndpoint('/api/students/')).toBe(false);
    expect(isAuthEndpoint(undefined)).toBe(false);
  });
});

describe('loginErrorMessage', () => {
  it('says the server is unreachable when there is no response', () => {
    expect(loginErrorMessage({})).toMatch(/internet connection/);
  });

  it('uses the server detail for bad credentials', () => {
    expect(loginErrorMessage({ response: { status: 401, data: { detail: 'No active account' } } })).toBe(
      'No active account',
    );
  });

  it('falls back to a generic message for bad credentials with no detail', () => {
    expect(loginErrorMessage({ response: { status: 401, data: {} } })).toMatch(/Invalid credentials/);
  });

  it('does not blame the credentials for a server error', () => {
    expect(loginErrorMessage({ response: { status: 503, data: {} } })).toMatch(/server had a problem/);
  });
});

describe('tokensFromRefresh', () => {
  it('keeps the rotated refresh token the server sends back', () => {
    expect(tokensFromRefresh({ access: 'a2', refresh: 'r2' })).toEqual({ access: 'a2', refresh: 'r2' });
  });

  it('copes with an answer that has no new refresh token', () => {
    expect(tokensFromRefresh({ access: 'a2' })).toEqual({ access: 'a2', refresh: null });
    expect(tokensFromRefresh({ access: 'a2', refresh: '' })).toEqual({ access: 'a2', refresh: null });
  });

  it('refuses an answer without an access token', () => {
    expect(tokensFromRefresh({})).toBeNull();
    expect(tokensFromRefresh({ access: '' })).toBeNull();
    expect(tokensFromRefresh(null)).toBeNull();
    expect(tokensFromRefresh({ access: 5 })).toBeNull();
  });
});

describe('phone sign-in header', () => {
  it('tells the server this is the phone app', () => {
    expect(MOBILE_CLIENT_HEADERS).toEqual({ 'X-Client': 'mobile' });
  });
});
