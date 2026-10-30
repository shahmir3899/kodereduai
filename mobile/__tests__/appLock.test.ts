import { LOCK_GRACE_MS, lockSupport, lockSupportMessage, shouldLockOnResume, startsLocked, unlockFailureText } from '../services/appLock';

const base = { enabled: true, signedIn: true, backgroundedAt: 1_000_000, now: 1_000_000 };

describe('when the app locks', () => {
  it('stays open for a short trip to another app', () => {
    expect(shouldLockOnResume({ ...base, now: base.backgroundedAt + LOCK_GRACE_MS - 1 })).toBe(false);
  });

  it('locks after the grace period', () => {
    expect(shouldLockOnResume({ ...base, now: base.backgroundedAt + LOCK_GRACE_MS })).toBe(true);
    expect(shouldLockOnResume({ ...base, now: base.backgroundedAt + 3_600_000 })).toBe(true);
  });

  it('locks when the clock went backwards', () => {
    expect(shouldLockOnResume({ ...base, now: base.backgroundedAt - 5 })).toBe(true);
  });

  it('never locks with the setting off, signed out, or if it was not backgrounded', () => {
    const late = { ...base, now: base.backgroundedAt + 999_999 };
    expect(shouldLockOnResume({ ...late, enabled: false })).toBe(false);
    expect(shouldLockOnResume({ ...late, signedIn: false })).toBe(false);
    expect(shouldLockOnResume({ ...late, backgroundedAt: null })).toBe(false);
  });

  it('starts locked only when signed in with the lock on', () => {
    expect(startsLocked(true, true)).toBe(true);
    expect(startsLocked(true, false)).toBe(false);
    expect(startsLocked(false, true)).toBe(false);
  });
});

describe('phone support', () => {
  it('tells what to do when the phone cannot unlock', () => {
    expect(lockSupport(false, false)).toBe('no-hardware');
    expect(lockSupport(true, false)).toBe('not-enrolled');
    expect(lockSupport(true, true)).toBe('ready');
    expect(lockSupportMessage('no-hardware')).toMatch(/no fingerprint/);
    expect(lockSupportMessage('not-enrolled')).toMatch(/settings/);
    expect(lockSupportMessage('ready')).toBe('');
  });

  it('words each way the prompt can end', () => {
    expect(unlockFailureText('user_cancel')).toBe('Unlock cancelled.');
    expect(unlockFailureText('lockout')).toMatch(/Too many/);
    expect(unlockFailureText('not_enrolled')).toMatch(/No fingerprint/);
    expect(unlockFailureText(undefined)).toMatch(/Could not unlock/);
  });
});
