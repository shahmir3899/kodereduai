// Timetable editing for admin and principal: the periods of the school day (slots) and the weekly
// grid of one class or section, a day at a time. Port of the manual part of the web TimetablePage
// (no auto-generate or AI suggestions). Pure logic, no React Native imports.

export const EDIT_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export type EditDay = (typeof EDIT_DAYS)[number];
export const DAY_NAMES: Record<EditDay, string> = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' };
export const DAY_SHORT: Record<EditDay, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat' };

export interface Slot {
  id: number;
  name: string;
  slot_type: string;
  start_time: string;
  end_time: string;
  order: number;
  is_active: boolean;
  applicable_days?: string[] | null;
}

export const SLOT_TYPES = [
  { value: 'PERIOD', label: 'Period' }, { value: 'BREAK', label: 'Break' }, { value: 'LUNCH', label: 'Lunch' }, { value: 'ASSEMBLY', label: 'Assembly' },
];

// Only a lesson period holds a subject; breaks, lunch and assembly are shown but not edited.
export const isLessonSlot = (s: Pick<Slot, 'slot_type'>) => s.slot_type === 'PERIOD';

// A slot with no day list runs every day (the server's default).
export const slotRunsOn = (s: Pick<Slot, 'applicable_days'>, day: EditDay) => !s.applicable_days || s.applicable_days.length === 0 || s.applicable_days.includes(day);

export function slotsForDay(slots: Slot[], day: EditDay): Slot[] {
  return slots.filter((s) => s.is_active !== false && slotRunsOn(s, day)).sort((a, b) => a.order - b.order);
}

export const shortTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
export const slotTimes = (s: Pick<Slot, 'start_time' | 'end_time'>) => `${shortTime(s.start_time)} to ${shortTime(s.end_time)}`;

// ─── The day's grid ──────────────────────────────────────────────────────────────────────────

export interface Entry {
  id?: number;
  day: string;
  slot: number;
  subject?: number | null;
  subject_name?: string | null;
  teacher?: number | null;
  teacher_name?: string | null;
  room?: string | null;
  is_section_override?: boolean;
}

export interface Cell { subject: number | null; subjectName: string; teacher: number | null; teacherName: string; room: string }
export type Draft = Record<number, Cell>;

export const emptyCell = (): Cell => ({ subject: null, subjectName: '', teacher: null, teacherName: '', room: '' });

export function draftFromEntries(entries: Entry[], day: EditDay): Draft {
  const out: Draft = {};
  for (const e of entries) {
    if (e.day !== day) continue;
    out[e.slot] = { subject: e.subject ?? null, subjectName: e.subject_name ?? '', teacher: e.teacher ?? null, teacherName: e.teacher_name ?? '', room: e.room ?? '' };
  }
  return out;
}

export const setCell = (d: Draft, slot: number, cell: Cell | null): Draft => {
  const next = { ...d };
  if (cell == null) delete next[slot]; else next[slot] = cell;
  return next;
};

const same = (a: Cell | undefined, b: Cell | undefined) =>
  (a?.subject ?? null) === (b?.subject ?? null) && (a?.teacher ?? null) === (b?.teacher ?? null) && (a?.room ?? '').trim() === (b?.room ?? '').trim();

export function dayChanged(original: Draft, draft: Draft): boolean {
  const slots = new Set([...Object.keys(original), ...Object.keys(draft)].map(Number));
  return Array.from(slots).some((s) => !same(original[s], draft[s]));
}

export const filledCount = (d: Draft) => Object.values(d).filter((c) => c.subject != null).length;

// Rows saved for the day: a cell with no subject is an empty period and is not sent.
export function entriesPayload(draft: Draft, slots: Slot[]): Array<{ slot: number; subject: number; teacher: number | null; room: string }> {
  return slots
    .filter((s) => draft[s.id]?.subject != null)
    .map((s) => ({ slot: s.id, subject: draft[s.id].subject as number, teacher: draft[s.id].teacher, room: draft[s.id].room.trim() }));
}

export interface DayScope { classObj: number; sessionClass: number | null; academicYear: number | null }

// A section saves its own override of the day; the class saves the shared day and leaves section
// overrides alone (same rule as the server's bulk_save).
export function bulkSavePayload(scope: DayScope, day: EditDay, draft: Draft, slots: Slot[]) {
  return {
    class_obj: scope.classObj, day,
    ...(scope.sessionClass != null ? { session_class: scope.sessionClass } : {}),
    ...(scope.academicYear != null ? { academic_year: scope.academicYear } : {}),
    entries: entriesPayload(draft, slots),
  };
}

// A class split into several sections shows each section's own view; saving there writes an override.
export const hasOverride = (entries: Entry[], day: EditDay) => entries.some((e) => e.day === day && e.is_section_override);

// The server answers bulk_save errors as { detail: [...] } (one line per row) or { detail: '...' }.
export function saveErrorLines(error: unknown): string[] {
  const e = error as { response?: { data?: { detail?: unknown } } } | null;
  if (!e?.response) return ['No connection. Connect to the internet and try again.'];
  const d = e.response.data?.detail;
  if (Array.isArray(d)) return d.map(String);
  if (typeof d === 'string') return [d];
  return ['Could not save the timetable. Try again.'];
}

// ─── Periods and breaks (slots) ─────────────────────────────────────────────────────────────

export interface SlotForm { name: string; type: string; start: string; end: string; order: string; days: EditDay[] }
export const emptySlotForm = (nextOrder: number): SlotForm => ({ name: '', type: 'PERIOD', start: '', end: '', order: String(nextOrder), days: [...EDIT_DAYS] });
export const slotToForm = (s: Slot): SlotForm => ({
  name: s.name, type: s.slot_type, start: shortTime(s.start_time), end: shortTime(s.end_time), order: String(s.order),
  days: (s.applicable_days && s.applicable_days.length ? s.applicable_days : [...EDIT_DAYS]).filter((d): d is EditDay => (EDIT_DAYS as readonly string[]).includes(d)),
});

export const nextSlotOrder = (slots: Slot[]) => slots.reduce((m, s) => Math.max(m, s.order), 0) + 1;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSlot(f: SlotForm, slots: Slot[], editingId: number | null): string | null {
  if (!f.name.trim()) return 'Enter a name, for example Period 1.';
  if (!TIME.test(f.start)) return 'Start time must look like 08:00 (24-hour).';
  if (!TIME.test(f.end)) return 'End time must look like 08:40 (24-hour).';
  if (f.end <= f.start) return 'The end time must be after the start time.';
  if (!/^\d+$/.test(f.order.trim())) return 'Enter the order as a whole number (1 is first).';
  if (slots.some((s) => s.id !== editingId && s.order === Number(f.order))) return 'Another period already has this order. Choose a free number.';
  if (f.days.length === 0) return 'Choose at least one day.';
  return null;
}

export const buildSlotPayload = (f: SlotForm) => ({
  name: f.name.trim(), slot_type: f.type, start_time: f.start, end_time: f.end, order: Number(f.order), applicable_days: f.days,
});

export const toggleDay = (days: EditDay[], day: EditDay): EditDay[] =>
  (days.includes(day) ? days.filter((d) => d !== day) : EDIT_DAYS.filter((d) => d === day || days.includes(d)));

// Two periods whose times overlap on a shared day make the grid confusing; flagged, not blocked.
export function overlappingSlots(slots: Slot[]): string[] {
  const out: string[] = [];
  const active = slots.filter((s) => s.is_active !== false);
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i], b = active[j];
      const share = EDIT_DAYS.some((d) => slotRunsOn(a, d) && slotRunsOn(b, d));
      if (share && a.start_time < b.end_time && b.start_time < a.end_time) out.push(`${a.name} and ${b.name} overlap.`);
    }
  }
  return out;
}
