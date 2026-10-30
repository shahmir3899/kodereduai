import * as SecureStore from 'expo-secure-store';

const KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  ACTIVE_SCHOOL_ID: 'active_school_id',
  // The school picked on the front screen. Kept across sign-outs, so the next sign-in opens on the
  // same school's page; clearTokens does not touch it.
  SCHOOL_CODE: 'school_code',
  // Device setting, kept across sign-outs: whether the app asks for a fingerprint or face to open.
  APP_LOCK: 'app_lock',
} as const;

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.ACCESS_TOKEN);
}

export async function setAccessToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, token);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.REFRESH_TOKEN);
}

export async function setRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, token);
}

export async function getActiveSchoolId(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.ACTIVE_SCHOOL_ID);
}

export async function setActiveSchoolId(id: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.ACTIVE_SCHOOL_ID, id);
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  await Promise.all([
    setAccessToken(access),
    setRefreshToken(refresh),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN),
    SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN),
    SecureStore.deleteItemAsync(KEYS.ACTIVE_SCHOOL_ID),
  ]);
}

export async function getSchoolCode(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.SCHOOL_CODE);
}

export async function setSchoolCode(code: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.SCHOOL_CODE, code);
}

export async function clearSchoolCode(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.SCHOOL_CODE);
}

export async function getAppLockEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEYS.APP_LOCK)) === '1';
}

export async function setAppLockEnabled(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(KEYS.APP_LOCK, '1');
  else await SecureStore.deleteItemAsync(KEYS.APP_LOCK);
}
