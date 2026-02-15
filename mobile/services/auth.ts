import * as SecureStore from 'expo-secure-store';

const KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  ACTIVE_SCHOOL_ID: 'active_school_id',
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
