// Browser-only stand-in for expo-secure-store, used when testing the app in a web browser.
// localStorage is not secure storage, so this file must never be used in a phone build.
export async function getItemAsync(key: string): Promise<string | null> {
  return window.localStorage.getItem(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  window.localStorage.setItem(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  window.localStorage.removeItem(key);
}
