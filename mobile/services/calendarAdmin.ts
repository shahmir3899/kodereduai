// Pure logic for the admin academic calendar: add, edit and delete an event or an OFF day. Field names
// and rules are the server's (academic_sessions SchoolCalendarEntrySerializer) and the web's entry form.
// An OFF day is not just a label: it switches attendance off for the students and marks staff On leave.

export const OFF_DAY_TYPES = [
  { value: 'SUMMER_VACATION', label: 'Summer vacation' },
  { value: 'WINTER_VACATION', label: 'Winter vacation' },
  { value: 'RELIGIOUS_HOLIDAY', label: 'Religious holiday' },
  { value: 'NATIONAL_HOLIDAY', label: 'National holiday' },
  { value: 'EXAM_BREAK', label: 'Exam break' },
  { value: 'OTHER', label: 'Other' },
];

export const ENTRY_KINDS = [{ value: 'EVENT', label: 'Event' }, { value: 'OFF_DAY', label: 'OFF day' }];
export const SCOPES = [{ value: 'SCHOOL', label: 'Whole school' }, { value: 'CLASS', label: 'Specific classes' }];

export const DEFAULT_EVENT_COLOR = '#0ea5e9';
export const DEFAULT_OFF_COLOR = '#dc2626';
export const SWATCHES = ['#0ea5e9', '#14b8a6', '#8b5cf6', '#ec4899', '#f59e0b', '#dc2626', '#64748b'];

export interface CalendarEntry {
  id: number;
  name: string;
  description?: string | null;
  entry_kind: 'EVENT' | 'OFF_DAY';
  off_day_type?: string | null;
  scope: 'SCHOOL' | 'CLASS';
  class_ids?: number[];
  class_names?: string[];
  start_date: string;
  end_date: string;
  color?: string | null;
  affects_students?: boolean;
  affects_staff?: boolean;
}

export interface EntryForm {
  name: string;
  description: string;
  kind: 'EVENT' | 'OFF_DAY';
  offType: string;
  scope: 'SCHOOL' | 'CLASS';
  start: string;
  end: string;
  color: string;
  classIds: number[];
  students: boolean;
  staff: boolean;
}

export const emptyEntryForm = (date: string): EntryForm => ({
  name: '', description: '', kind: 'EVENT', offType: 'OTHER', scope: 'SCHOOL', start: date, end: date,
  color: DEFAULT_EVENT_COLOR, classIds: [], students: true, staff: true,
});

export const entryToForm = (e: CalendarEntry): EntryForm => ({
  name: e.name, description: e.description ?? '', kind: e.entry_kind, offType: e.off_day_type || 'OTHER', scope: e.scope,
  start: e.start_date, end: e.end_date, color: e.color || (e.entry_kind === 'OFF_DAY' ? DEFAULT_OFF_COLOR : DEFAULT_EVENT_COLOR),
  classIds: e.class_ids ?? [], students: e.affects_students ?? true, staff: e.affects_staff ?? true,
});

export function validateEntry(f: EntryForm): string | null {
  if (!f.name.trim()) return 'Enter a title.';
  if (!f.start || !f.end) return 'Choose the start and end dates.';
  if (f.start > f.end) return 'The end date cannot be before the start date.';
  if (f.scope === 'CLASS' && f.classIds.length === 0) return 'Choose at least one class, or use the whole school.';
  if (f.kind === 'OFF_DAY' && !f.students && !f.staff) return 'An OFF day must apply to students, staff or both.';
  return null;
}

// Only an OFF day has a category and an applies-to choice; an event always applies to everyone.
export function buildEntryPayload(yearId: number, f: EntryForm) {
  const off = f.kind === 'OFF_DAY';
  return {
    academic_year: yearId,
    name: f.name.trim(),
    description: f.description.trim(),
    entry_kind: f.kind,
    off_day_type: off ? f.offType : '',
    scope: f.scope,
    start_date: f.start,
    end_date: f.end,
    color: f.color,
    affects_students: off ? f.students : true,
    affects_staff: off ? f.staff : true,
    class_ids: f.scope === 'CLASS' ? f.classIds : [],
    is_active: true,
  };
}

// What saving an OFF day will do, said before it is saved.
export function offDayEffect(f: Pick<EntryForm, 'kind' | 'students' | 'staff' | 'scope'>): string | null {
  if (f.kind !== 'OFF_DAY') return null;
  const parts: string[] = [];
  if (f.students) parts.push('attendance is not taken for students');
  if (f.staff) parts.push('staff are marked On leave automatically');
  if (parts.length === 0) return null;
  return `On these days ${parts.join(' and ')}${f.scope === 'CLASS' ? ' (only in the chosen classes)' : ''}.`;
}

export function monthRange(year: number, month: number): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(year, month, 0).getDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

export function listParams(yearId: number, year: number, month: number): Record<string, unknown> {
  const { from, to } = monthRange(year, month);
  return { academic_year: yearId, date_from: from, date_to: to, is_active: true, page_size: 200 };
}

export function entryDatesLine(e: Pick<CalendarEntry, 'start_date' | 'end_date'>): string {
  return e.start_date === e.end_date ? e.start_date : `${e.start_date} to ${e.end_date}`;
}

export function entryMeta(e: CalendarEntry): string {
  const kind = e.entry_kind === 'OFF_DAY' ? (OFF_DAY_TYPES.find((t) => t.value === e.off_day_type)?.label ?? 'OFF day') : 'Event';
  const who = e.scope === 'CLASS' ? (e.class_names?.length ? e.class_names.join(', ') : 'Some classes') : 'Whole school';
  return `${kind}  ·  ${who}`;
}

export const sortEntries = (list: CalendarEntry[]) =>
  [...list].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name));

// A master class id from a class picker option: a section carries its class, a class is itself.
export const masterClassId = (o: { id: number; classObj: number | null; isSession: boolean }) => (o.isSession ? o.classObj : o.id);

// The server refuses overlaps and bad dates with a message; show the first one.
export function entryErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === 'string' && data.trim() && data.length < 200) return data;
  if (data && typeof data === 'object') {
    for (const v of Object.values(data as Record<string, unknown>)) {
      const text = Array.isArray(v) ? v.map(String).join(' ') : typeof v === 'string' ? v : '';
      if (text) return text;
    }
  }
  return fallback;
}
