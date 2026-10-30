// App lock: after the app has been in the background for a while (or on a cold start) the person
// must unlock it with their fingerprint, face or phone screen lock before seeing anything. It sits on
// top of the long sign-in, so a lost phone does not hand over school data for the 30 days the session
// lasts. Pure rules, no React Native imports.

// Switching apps for a moment (a call, a photo) must not demand a fingerprint each time.
export const LOCK_GRACE_MS = 30_000;

export interface LockInput {
  enabled: boolean;
  signedIn: boolean;
  // When the app went to the background; null when it has not since the app started.
  backgroundedAt: number | null;
  now: number;
}

// Lock when coming back after the grace period. A clock that moved backwards locks too: it cannot be
// told apart from a long absence.
export function shouldLockOnResume({ enabled, signedIn, backgroundedAt, now }: LockInput): boolean {
  if (!enabled || !signedIn || backgroundedAt == null) return false;
  const away = now - backgroundedAt;
  return away < 0 || away >= LOCK_GRACE_MS;
}

// A cold start while signed in with the lock on starts locked.
export const startsLocked = (enabled: boolean, signedIn: boolean) => enabled && signedIn;

export type LockSupport = 'ready' | 'no-hardware' | 'not-enrolled';

export function lockSupport(hasHardware: boolean, enrolled: boolean): LockSupport {
  if (!hasHardware) return 'no-hardware';
  return enrolled ? 'ready' : 'not-enrolled';
}

export function lockSupportMessage(s: LockSupport): string {
  if (s === 'no-hardware') return 'This phone has no fingerprint or face unlock.';
  if (s === 'not-enrolled') return 'Set up a fingerprint, face or screen lock in your phone settings first, then turn this on.';
  return '';
}

// The prompt can end without success for reasons that are not a wrong finger: the person cancelled,
// or the sensor is locked out for a while. Only the first lets them simply try again.
export function unlockFailureText(error: string | undefined): string {
  switch (error) {
    case 'user_cancel':
    case 'system_cancel':
    case 'app_cancel':
      return 'Unlock cancelled.';
    case 'lockout':
      return 'Too many tries. Wait a moment, or use your phone screen lock.';
    case 'not_enrolled':
      return 'No fingerprint, face or screen lock is set up on this phone.';
    default:
      return 'Could not unlock. Try again.';
  }
}
