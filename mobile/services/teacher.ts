import { buildClassOptions, type ClassOption } from './attendanceEntry';

// Pure teacher helpers; mirrors frontend/src/hooks/useTeacherScopedClasses.js and the timetable
// handling in pages/teacher/teacherDashboardUtils.js.

export const DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type DayCode = (typeof DAY_CODES)[number];
export const DAY_LABELS: Record<DayCode, string> = {
  MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun',
};

export function dayCodeFor(date: Date): DayCode {
  // Date#getDay is 0 for Sunday.
  return DAY_CODES[(date.getDay() + 6) % 7];
}

interface ScopeClass { id: number; name: string; section?: string; grade_level?: number | string; is_active?: boolean }
interface ScopeSessionClass {
  id?: number; class_obj?: number | null; display_name?: string; class_obj_name?: string;
  label?: string; section?: string; is_active?: boolean; grade_level?: number | string;
}

// The sections a teacher may mark: the active year's session classes whose master class the
// server says they are assigned to, else the assigned master classes themselves. The server
// still enforces the section on save.
export function teacherClassOptions(myClasses: ScopeClass[], sessionClasses: ScopeSessionClass[]): ClassOption[] {
  if (myClasses.length === 0) return [];
  const allowed = new Set(myClasses.map((c) => Number(c.id)));
  const scoped = sessionClasses.filter((sc) => allowed.has(Number(sc.class_obj)));
  return buildClassOptions(scoped, myClasses).options;
}

export interface TimetableEntry {
  id: number;
  day: DayCode;
  slot_name?: string;
  slot_order?: number;
  slot_type?: string;
  slot_start_time?: string | null;
  slot_end_time?: string | null;
  subject_name?: string | null;
  class_name?: string;
  class_obj?: number;
  session_class?: number | null;
  teacher?: number | null;
}

export function entriesForDay<T extends TimetableEntry>(entries: T[], day: DayCode): T[] {
  return entries
    .filter((e) => e.day === day)
    .sort((a, b) => (a.slot_order ?? 0) - (b.slot_order ?? 0));
}

// Days that have at least one period, in week order.
export function daysWithEntries(entries: TimetableEntry[]): DayCode[] {
  const present = new Set(entries.map((e) => e.day));
  return DAY_CODES.filter((d) => present.has(d));
}

// '13:05:00' -> '1:05 PM'. Slots without a time give ''.
export function formatSlotTime(time?: string | null): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`;
}
