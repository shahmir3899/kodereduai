import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Persona } from '../navigation/personas';
import { pickAcademicYear, type AcademicYear } from './academicYear';

// The academic year a person has chosen to look at, kept per person and school on this phone.
// Only the roles below can choose; everyone else always works in the school's current year.
export function canChooseYear(persona: Persona): boolean {
  return persona === 'admin' || persona === 'manager' || persona === 'accountant';
}

// The chosen year when it still exists and this role may choose and the screen is not locked,
// otherwise the school's current year. `lockToCurrent` is for screens that write today's records
// (attendance, fee collection), which must never end up in an old year by accident.
export function resolveYear(years: AcademicYear[], choiceId: number | null, opts: { allowed: boolean; lockToCurrent?: boolean }): AcademicYear | null {
  const actual = pickAcademicYear(years);
  if (!opts.allowed || opts.lockToCurrent || choiceId == null) return actual;
  return years.find((y) => y.id === choiceId) ?? actual;
}

export const isPastYear = (current: AcademicYear | null, actual: AcademicYear | null) => !!current && !!actual && current.id !== actual.id;

const keyFor = (userId?: number | string, schoolId?: number | string) => `academicYearChoice:${userId ?? 'x'}:${schoolId ?? 'x'}`;

export async function loadYearChoice(userId?: number | string, schoolId?: number | string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId, schoolId));
    const n = raw == null ? NaN : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

export async function saveYearChoice(userId: number | string | undefined, schoolId: number | string | undefined, id: number | null): Promise<void> {
  try {
    if (id == null) await AsyncStorage.removeItem(keyFor(userId, schoolId));
    else await AsyncStorage.setItem(keyFor(userId, schoolId), String(id));
  } catch { /* the choice is not kept */ }
}

// One shared value for every screen: choosing a year in the header changes it everywhere at once.
type Listener = () => void;
const store = { scope: '', id: null as number | null, listeners: new Set<Listener>() };
export const yearStore = {
  get: (scope: string) => (store.scope === scope ? store.id : null),
  set(scope: string, id: number | null) { store.scope = scope; store.id = id; store.listeners.forEach((l) => l()); },
  // First screen to ask for a person's school loads the saved choice; the others find it loaded.
  async ensureLoaded(userId?: number | string, schoolId?: number | string) {
    const scope = keyFor(userId, schoolId);
    if (store.scope === scope) return;
    store.scope = scope; store.id = null;
    const saved = await loadYearChoice(userId, schoolId);
    if (store.scope === scope && saved != null) { store.id = saved; store.listeners.forEach((l) => l()); }
  },
  subscribe(l: Listener) { store.listeners.add(l); return () => { store.listeners.delete(l); }; },
};
export const scopeKey = keyFor;
