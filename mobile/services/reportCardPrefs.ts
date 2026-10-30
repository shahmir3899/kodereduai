import AsyncStorage from '@react-native-async-storage/async-storage';

// The chosen report card PDF layout, kept on this phone only. Storage can be unavailable, so every
// call is safe to ignore: the choice then just resets to the default next time.
const KEY = 'reportCardTemplate';

export async function loadTemplate(): Promise<string | null> {
  try { return await AsyncStorage.getItem(KEY); } catch { return null; }
}

export async function saveTemplate(value: string): Promise<void> {
  try { await AsyncStorage.setItem(KEY, value); } catch { /* the choice is not kept */ }
}
