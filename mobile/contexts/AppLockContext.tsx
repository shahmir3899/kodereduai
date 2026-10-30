import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, View, Text, StyleSheet } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAuth } from './AuthContext';
import { getAppLockEnabled, setAppLockEnabled } from '../services/auth';
import { lockSupport, lockSupportMessage, shouldLockOnResume, startsLocked, unlockFailureText } from '../services/appLock';
import Button from '../components/ui/Button';
import { Colors, FontSize, Spacing } from '../constants/colors';

interface AppLockApi {
  enabled: boolean;
  // Turns the lock on or off after checking the phone supports it and the person passes the prompt
  // (so a thief cannot simply switch it off). Returns an error text, or null on success.
  setEnabled: (on: boolean) => Promise<string | null>;
}

const AppLockContext = createContext<AppLockApi | null>(null);

async function prompt(message: string) {
  return LocalAuthentication.authenticateAsync({ promptMessage: message, cancelLabel: 'Cancel', disableDeviceFallback: false });
}

// Sits under the auth provider. While locked, a full-screen cover hides the whole app until the person
// passes the phone's fingerprint, face or screen-lock prompt. Sign-in itself is unchanged.
export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, logout } = useAuth();
  const [enabled, setEnabledState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState('');
  const backgroundedAt = useRef<number | null>(null);
  const started = useRef(false);
  // While our own prompt is on screen the app can report "inactive"; that must not count as leaving.
  const prompting = useRef(false);

  useEffect(() => { getAppLockEnabled().then((v) => { setEnabledState(v); setLoaded(true); }, () => setLoaded(true)); }, []);

  // Cold start: a signed-in phone with the lock on opens locked.
  useEffect(() => {
    if (!loaded || loading || started.current) return;
    started.current = true;
    setLocked(startsLocked(enabled, isAuthenticated));
  }, [loaded, loading, enabled, isAuthenticated]);

  // Signing out clears the lock: there is nothing to protect on the sign-in page.
  useEffect(() => { if (!isAuthenticated) setLocked(false); }, [isAuthenticated]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && !prompting.current) {
        if (shouldLockOnResume({ enabled, signedIn: isAuthenticated, backgroundedAt: backgroundedAt.current, now: Date.now() })) setLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, [enabled, isAuthenticated]);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setMessage('');
    try {
      const result = await prompt('Unlock Education AI');
      if (result.success) setLocked(false);
      else setMessage(unlockFailureText((result as { error?: string }).error));
    } finally {
      prompting.current = false;
    }
  }, []);

  // Ask for the fingerprint as soon as the cover appears.
  useEffect(() => { if (locked) unlock(); }, [locked, unlock]);

  const setEnabled = useCallback(async (on: boolean): Promise<string | null> => {
    if (on) {
      const support = lockSupport(await LocalAuthentication.hasHardwareAsync(), await LocalAuthentication.isEnrolledAsync());
      if (support !== 'ready') return lockSupportMessage(support);
    }
    prompting.current = true;
    try {
      const result = await prompt(on ? 'Confirm to turn on the app lock' : 'Confirm to turn off the app lock');
      if (!result.success) return unlockFailureText((result as { error?: string }).error);
    } finally {
      prompting.current = false;
    }
    await setAppLockEnabled(on);
    setEnabledState(on);
    return null;
  }, []);

  return (
    <AppLockContext.Provider value={{ enabled, setEnabled }}>
      {children}
      {locked ? (
        <View style={styles.cover} accessibilityViewIsModal accessibilityLabel="The app is locked">
          <Text style={styles.title}>Education AI is locked</Text>
          {message ? <Text style={styles.message} accessibilityRole="alert">{message}</Text> : null}
          <Button title="Unlock" onPress={unlock} size="lg" />
          <Button title="Sign out and use password" variant="ghost" onPress={logout} />
        </View>
      ) : null}
    </AppLockContext.Provider>
  );
}

export function useAppLock(): AppLockApi {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used within an AppLockProvider');
  return ctx;
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.lg, zIndex: 1000, elevation: 1000 },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  message: { fontSize: FontSize.sm, color: Colors.error, textAlign: 'center' },
});
