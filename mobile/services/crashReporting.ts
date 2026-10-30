import * as Sentry from '@sentry/react-native';

// Off unless a DSN is configured (EXPO_PUBLIC_SENTRY_DSN in the EAS build env), so local runs and
// builds without one send nothing. The DSN is a public ingest key, not a secret.
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const APP_ENV = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';

let started = false;

export function startCrashReporting(): void {
  if (started || !DSN || APP_ENV === 'development') return;
  started = true;
  Sentry.init({
    dsn: DSN,
    environment: APP_ENV,
    // Student, fee and mark data must never leave the phone in a report: no IP/user details,
    // no request bodies, no screenshots.
    sendDefaultPii: false,
    attachScreenshot: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
  });
}

// Called by the root error boundary. A no-op when reporting is off (no DSN).
export function reportCrash(error: unknown): void {
  if (started) Sentry.captureException(error);
}
