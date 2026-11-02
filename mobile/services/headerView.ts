// Pure rules for the header actions.
import type { Persona } from '../navigation/personas';

// Staff-type shells can read the academic year list; parents, students and drivers cannot.
export function shouldShowYearChip(persona: Persona): boolean {
  return persona === 'admin' || persona === 'teacher' || persona === 'manager' || persona === 'accountant' || persona === 'staff';
}

// The badge text for the unread count: nothing for zero, "99+" past 99.
export function unreadLabel(count: number): string | null {
  if (!(count > 0)) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}
