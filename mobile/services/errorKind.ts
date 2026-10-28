// Pure classification of a failed request, so every error screen can say what actually went
// wrong (no connection, no permission, server down) instead of one generic line.

export type ErrorKind = 'offline' | 'timeout' | 'forbidden' | 'notFound' | 'server' | 'unknown';

type ErrorLike = { code?: string; response?: { status?: number } } | null | undefined;

export function classifyError(error: unknown): ErrorKind {
  const e = error as ErrorLike;
  if (!e) return 'unknown';
  const status = e.response?.status;
  if (status === undefined) {
    if (e.code === 'ECONNABORTED') return 'timeout';
    // axios reports a dropped connection as ERR_NETWORK with no response.
    if (e.code === 'ERR_NETWORK') return 'offline';
    return 'unknown';
  }
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status >= 500) return 'server';
  return 'unknown';
}

export interface ErrorCopy {
  title: string;
  message: string;
}

const COPY: Record<ErrorKind, ErrorCopy> = {
  offline: {
    title: 'No connection',
    message: 'Check your internet connection and try again.',
  },
  timeout: {
    title: 'Taking too long',
    message: 'The connection is slow. Try again in a moment.',
  },
  forbidden: {
    title: 'Not allowed',
    message: 'Your account does not have access to this. Ask your school admin if you need it.',
  },
  notFound: {
    title: 'Not found',
    message: 'This is no longer available. It may have been removed.',
  },
  server: {
    title: 'Server problem',
    message: 'Something went wrong on our side. Please try again shortly.',
  },
  unknown: {
    title: 'Could not load',
    message: 'Something went wrong while loading this.',
  },
};

export function errorCopy(error: unknown): ErrorCopy {
  return COPY[classifyError(error)];
}

// For toasts after a failed save: say it is a connection problem, since nothing was saved.
export function saveFailureMessage(error: unknown, fallback = 'Could not save. Please try again.'): string {
  const kind = classifyError(error);
  if (kind === 'offline' || kind === 'timeout') {
    return 'Not saved: no connection. Check your internet and try again.';
  }
  if (kind === 'forbidden') return 'Not saved: your account is not allowed to do this.';
  return fallback;
}

export const OFFLINE_COPY: ErrorCopy = {
  title: "You're offline",
  message: 'This needs an internet connection and is not saved on your phone. Reconnect and try again.',
};
