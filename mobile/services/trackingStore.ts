import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActiveJourney, Ping } from './tracking';

// What the background location task needs to survive the app being killed. A module variable is
// lost with the process; the task wakes in a fresh JS runtime, so it must read these.
const JOURNEY_KEY = 'tracking.activeJourney';
const BUFFER_KEY = 'tracking.buffer';
const LAST_OK_KEY = 'tracking.lastOkAt';

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const write = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined);

export const loadActiveJourney = () => read<ActiveJourney | null>(JOURNEY_KEY, null);
export const saveActiveJourney = (j: ActiveJourney) => write(JOURNEY_KEY, j);
export const loadBuffer = () => read<Ping[]>(BUFFER_KEY, []);
export const saveBuffer = (b: Ping[]) => write(BUFFER_KEY, b);
export const loadLastOk = () => read<number | null>(LAST_OK_KEY, null);
export const saveLastOk = (at: number) => write(LAST_OK_KEY, at);

export async function clearTracking(): Promise<void> {
  await AsyncStorage.multiRemove([JOURNEY_KEY, BUFFER_KEY, LAST_OK_KEY]).catch(() => undefined);
}
