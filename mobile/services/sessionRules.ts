// Pure rules for when a failed request means "the session is over", kept out of api.ts so they
// can be tested without axios or SecureStore.

type ErrorLike = { response?: { status?: number; data?: any } } | null | undefined;

// A wrong password on these returns 401, which must not be mistaken for an expired session.
const NO_REFRESH_PATHS = [
  '/api/auth/login/',
  '/api/auth/refresh/',
  '/api/parents/register/',
  '/api/auth/password-reset/',
];

export function isAuthEndpoint(url: string | undefined): boolean {
  if (!url) return false;
  return NO_REFRESH_PATHS.some((p) => url.includes(p));
}

// Only an explicit rejection of the refresh token ends the session. No response at all (offline,
// timeout) or a 5xx says nothing about the token, and logging out then would sign a user out
// every time the connection drops while the access token happens to expire.
export function refreshEndsSession(error: ErrorLike): boolean {
  const status = error?.response?.status;
  return status === 400 || status === 401 || status === 403;
}

export function loginErrorMessage(error: ErrorLike): string {
  if (!error?.response) {
    return 'Could not reach the server. Check your internet connection and try again.';
  }
  const { status, data } = error.response;
  if (status && status >= 500) {
    return 'The server had a problem. Please try again in a moment.';
  }
  return data?.detail || data?.error || 'Invalid credentials. Please try again.';
}
