// Pure rules for the header actions.
import type { Persona } from '../navigation/personas';

// Staff-type shells can read the academic year list; parents, students and drivers cannot.
export function shouldShowYearChip(persona: Persona): boolean {
  return persona === 'admin' || persona === 'teacher' || persona === 'manager' || persona === 'finance' || persona === 'staff';
}

// The badge text for the unread count: nothing for zero, "99+" past 99.
export function unreadLabel(count: number): string | null {
  if (!(count > 0)) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}

// Where the header back arrow goes: back when there is history, otherwise the role's Home (a
// notification or a link can open the app straight onto an inner screen with nothing behind it).
export function backTarget(canGoBack: boolean, persona: Persona): 'back' | string {
  return canGoBack ? 'back' : `/(${persona})/dashboard`;
}

// "2025-2026" -> "2025-26", and any prefix before the years is dropped ("SEED_TEST_2025-2026"),
// so the chip never squeezes the screen title. A name without a year range is kept as it is.
export function shortYearLabel(name: string): string {
  const m = /(\d{4})\s*[-–/]\s*(\d{2}|\d{4})(?!\d)/.exec(name ?? '');
  if (!m) return name ?? '';
  return `${m[1]}-${m[2].slice(-2)}`;
}
