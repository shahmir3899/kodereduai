// Pure logic for the whole-week timetable view and its helpers: the week grid, the quality score, the teacher clash
// check with suggested alternatives, finding a substitute, and giving each section its own timetable. Port of
// frontend/src/pages/academics/TimetablePage.jsx (the generation features stay on the web). The quality score, clash
// suggestions and substitute finder are rule-based on the server; nothing here calls an AI model.

import { EDIT_DAYS, isLessonSlot, slotRunsOn, slotsForDay, type EditDay, type Entry, type Slot } from './timetableEdit';

// ─── The week grid ─────────────────────────────────────────────────────────────────────────

export interface WeekCell { subjectId: number | null; subject: string; teacher: string; room: string; override: boolean }

// One row per period or break; a day the period does not run on is null ("off"), a lesson with nothing set is an empty cell.
export interface WeekRow { slot: Slot; lesson: boolean; days: Record<EditDay, WeekCell | null | 'off'> }

export function buildWeek(slots: Slot[], entries: Entry[]): WeekRow[] {
  const active = slots.filter((s) => s.is_active !== false).sort((a, b) => a.order - b.order);
  return active.map((slot) => {
    const days = {} as WeekRow['days'];
    EDIT_DAYS.forEach((d) => {
      if (!slotRunsOn(slot, d)) { days[d] = 'off'; return; }
      const e = entries.find((x) => x.day === d && x.slot === slot.id && x.subject != null);
      days[d] = e ? { subjectId: e.subject ?? null, subject: e.subject_name || 'Subject', teacher: e.teacher_name || '', room: e.room || '', override: !!e.is_section_override } : null;
    });
    return { slot, lesson: isLessonSlot(slot), days };
  });
}

// Days that have at least one lesson to show, so a school that runs five days does not get an empty Saturday column.
export function weekDays(rows: WeekRow[]): EditDay[] {
  const used = EDIT_DAYS.filter((d) => rows.some((r) => r.days[d] && r.days[d] !== 'off'));
  return used.length ? used : EDIT_DAYS.filter((d) => rows.some((r) => r.days[d] !== 'off'));
}

// The same subject keeps the same colour in every cell, whatever the order the entries come in.
export const SUBJECT_COLOURS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];

export function subjectColours(entries: Entry[]): Map<number, string> {
  const ids = [...new Set(entries.map((e) => e.subject).filter((s): s is number => s != null))].sort((a, b) => a - b);
  return new Map(ids.map((id, i) => [id, SUBJECT_COLOURS[i % SUBJECT_COLOURS.length]]));
}

// Counted over the days shown, so a school that runs five days does not get two empty Saturday cells in the total.
export function weekCounts(rows: WeekRow[], days: EditDay[] = EDIT_DAYS as unknown as EditDay[]): { filled: number; total: number } {
  let filled = 0;
  let total = 0;
  rows.filter((r) => r.lesson).forEach((r) => days.forEach((d) => {
    if (r.days[d] === 'off') return;
    total += 1;
    if (r.days[d]) filled += 1;
  }));
  return { filled, total };
}

// A section that has its own days: those days are the section's, the rest follow the class.
export function overrideDays(entries: Entry[]): EditDay[] {
  const set = new Set(entries.filter((e) => e.is_section_override).map((e) => e.day));
  return EDIT_DAYS.filter((d) => set.has(d));
}

export const hasSharedEntries = (entries: Entry[]): boolean => entries.some((e) => !e.is_section_override);

export { slotsForDay };

// ─── Quality score ─────────────────────────────────────────────────────────────────────────

export interface QualityData {
  overall_score?: number; teacher_idle_gaps?: number; subject_distribution?: number; break_placement?: number;
  workload_balance?: number; constraint_satisfaction?: number;
}

export const SCORE_PARTS: Array<{ key: keyof QualityData; label: string; weight: string }> = [
  { key: 'constraint_satisfaction', label: 'Constraint satisfaction', weight: '25%' },
  { key: 'subject_distribution', label: 'Subject distribution', weight: '25%' },
  { key: 'teacher_idle_gaps', label: 'Teacher idle gaps', weight: '20%' },
  { key: 'break_placement', label: 'Break placement', weight: '15%' },
  { key: 'workload_balance', label: 'Workload balance', weight: '15%' },
];

export type Tone = 'success' | 'warning' | 'error';
export const scoreTone = (s: number): Tone => (s >= 80 ? 'success' : s >= 60 ? 'warning' : 'error');

// The web shows the badge only when the class has a timetable (overall above zero).
export const showScore = (q: QualityData | null | undefined): q is QualityData => !!q && Number(q.overall_score) > 0;

export function scoreParts(q: QualityData): Array<{ label: string; weight: string; value: number; tone: Tone }> {
  return SCORE_PARTS.map((p) => {
    const v = Number(q[p.key]) || 0;
    return { label: p.label, weight: p.weight, value: Math.round(v), tone: scoreTone(v) };
  });
}

// ─── Teacher clash and alternatives ────────────────────────────────────────────────────────

export interface ConflictData { has_conflict?: boolean; conflicts?: Array<{ class_name?: string; subject_name?: string }> }

export function conflictLine(c: ConflictData | null | undefined): string | null {
  if (!c?.has_conflict) return null;
  const first = c.conflicts?.[0];
  return `Conflict: this teacher is already assigned to ${first?.class_name || 'another class'} at this period.`;
}

// What the server needs to check one cell; editing a section excludes that section's own rows, editing a class excludes the class.
export function conflictParams(teacher: number, day: string, slot: number, classObj: number | null, sessionClass: number | null): Record<string, unknown> {
  return { teacher, day, slot, ...(sessionClass ? { exclude_session_class: sessionClass } : { exclude_class: classObj }) };
}

export interface ResolutionData {
  alternative_teachers?: Array<{ teacher_id: number; teacher_name: string; qualification_match?: number; reason?: string }>;
  alternative_slots?: Array<{ day: string; slot_name?: string }>;
  swap_suggestions?: Array<{ reason?: string }>;
}

export function resolutionView(r: ResolutionData | null | undefined) {
  return {
    teachers: (r?.alternative_teachers ?? []).slice(0, 5),
    slots: (r?.alternative_slots ?? []).slice(0, 8),
    swaps: r?.swap_suggestions ?? [],
  };
}

export const hasSuggestions = (r: ReturnType<typeof resolutionView>): boolean => r.teachers.length + r.slots.length + r.swaps.length > 0;

export const DAY_FULL: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat' };
export const slotLine = (s: { day: string; slot_name?: string }) => `${DAY_FULL[s.day] ?? s.day} ${s.slot_name ?? ''}`.trim();

// ─── Substitutes ───────────────────────────────────────────────────────────────────────────

export interface SubstituteData {
  error?: string; absent_teacher_name?: string; date?: string; message?: string;
  entries_needing_cover?: Array<{
    slot_name?: string; slot_start?: string; slot_end?: string; class_name?: string; subject_name?: string;
    suggested_substitutes?: Array<{ teacher_name: string; score: number; reason?: string }>;
  }>;
}

export function substituteView(d: SubstituteData | null | undefined) {
  return {
    error: d?.error ?? null,
    heading: d && !d.error ? `${d.absent_teacher_name ?? ''} on ${d.date ?? ''}${d.message ? ` — ${d.message}` : ''}` : '',
    entries: d?.entries_needing_cover ?? [],
  };
}

export const strongSubstitute = (score: number): boolean => score >= 70;

export function validateSubstitute(teacher: number | null, date: string): string | null {
  if (!teacher) return 'Choose the teacher who is away.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Choose the date.';
  return null;
}

// ─── Give each section its own timetable ───────────────────────────────────────────────────

export function splitResultText(data: unknown): string {
  const d = data as { sections?: string[]; created?: number; teacher_clashes?: number } | null;
  const names = (d?.sections ?? []).join(', ');
  const clashes = d?.teacher_clashes ?? 0;
  return `Each section now has its own timetable (${names}; ${d?.created ?? 0} entries). `
    + (clashes
      ? `${clashes} period${clashes === 1 ? '' : 's'} have the same teacher in more than one section; give each section its own teacher there before saving those days.`
      : 'No teacher is double-booked.');
}
