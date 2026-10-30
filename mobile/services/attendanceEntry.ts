import { schoolToday } from './schoolTime';
import { format } from 'date-fns';

// Pure logic behind the manual attendance screen; mirrors frontend/src/pages/ManualEntryPage.jsx.

export type AttendanceStatus = 'NOT_SET' | 'PRESENT' | 'ABSENT' | 'LEAVE';
export const STATUS_CYCLE: AttendanceStatus[] = ['NOT_SET', 'PRESENT', 'ABSENT', 'LEAVE'];

export interface ClassOption {
  id: number;
  label: string;
  // Master class behind a session class; null for master-only options.
  classObj: number | null;
  isSession: boolean;
}

export interface Row {
  studentId: number;
  name: string;
  roll: string;
  status: AttendanceStatus;
}

interface SessionClassDto {
  id?: number;
  class_obj?: number | null;
  display_name?: string;
  class_obj_name?: string;
  label?: string;
  section?: string;
  is_active?: boolean;
  grade_level?: number | string;
}
interface MasterClassDto {
  id: number;
  name: string;
  section?: string;
  is_active?: boolean;
  grade_level?: number | string;
}

function byGradeThenLabel(a: { grade: number; label: string }, b: { grade: number; label: string }) {
  return a.grade - b.grade || a.label.localeCompare(b.label);
}

// Session classes when the active year has any, else the master classes (same rule as the web:
// a year without SessionClass rows still has to be usable).
export function buildClassOptions(
  sessionClasses: SessionClassDto[],
  masterClasses: MasterClassDto[],
): { options: ClassOption[]; useSession: boolean } {
  const session = sessionClasses
    .filter((sc) => !!sc.id && !!sc.class_obj && sc.is_active !== false)
    .map((sc) => {
      const name = sc.display_name || sc.class_obj_name || `Class ${sc.class_obj}`;
      const section = String(sc.section || '').trim();
      return {
        grade: Number(sc.grade_level) || 0,
        option: {
          id: sc.id as number,
          label: sc.label || (section ? `${name} - ${section}` : name),
          classObj: sc.class_obj as number,
          isSession: true,
        },
      };
    });
  if (session.length > 0) {
    const sorted = session
      .map((s) => ({ grade: s.grade, label: s.option.label, option: s.option }))
      .sort(byGradeThenLabel);
    return { options: sorted.map((s) => s.option), useSession: true };
  }

  const master = masterClasses
    .filter((c) => c.is_active !== false)
    .map((c) => {
      const section = String(c.section || '').trim();
      const label = section ? `${c.name} - ${section}` : c.name;
      return { grade: Number(c.grade_level) || 0, label, option: { id: c.id, label, classObj: null, isSession: false } };
    })
    .sort(byGradeThenLabel);
  return { options: master.map((m) => m.option), useSession: false };
}

// Class filter params shared by enrolment, records and save requests.
export function classParams(option: ClassOption, academicYearId: number | null): Record<string, unknown> {
  if (option.isSession && academicYearId) {
    return {
      session_class_id: option.id,
      academic_year: academicYearId,
      ...(option.classObj ? { class_id: option.classObj } : {}),
    };
  }
  return { class_id: option.classObj ?? option.id };
}

interface EnrollmentDto { student: number; student_name: string; roll_number?: string | null }
interface RecordDto { student?: number; student_id?: number; status: string }

// Enrolled students with any saved status applied; unmarked ones start NOT_SET. Sorted by roll.
export function buildRows(enrollments: EnrollmentDto[], records: RecordDto[]): Row[] {
  const saved = new Map<number, AttendanceStatus>();
  for (const r of records) {
    const id = r.student ?? r.student_id;
    if (id != null && STATUS_CYCLE.includes(r.status as AttendanceStatus)) saved.set(id, r.status as AttendanceStatus);
  }
  return enrollments
    .map((e) => ({
      studentId: e.student,
      name: e.student_name,
      roll: e.roll_number ? String(e.roll_number) : '',
      status: saved.get(e.student) ?? ('NOT_SET' as AttendanceStatus),
    }))
    .sort((a, b) => (parseInt(a.roll, 10) || 0) - (parseInt(b.roll, 10) || 0));
}

export function setStatus(rows: Row[], studentId: number, status: AttendanceStatus): Row[] {
  return rows.map((r) => (r.studentId === studentId ? { ...r, status } : r));
}

export function markAll(rows: Row[], status: AttendanceStatus): Row[] {
  return rows.map((r) => ({ ...r, status }));
}

export function countStatuses(rows: Row[]) {
  const c = { present: 0, absent: 0, leave: 0, notSet: 0 };
  for (const r of rows) {
    if (r.status === 'PRESENT') c.present += 1;
    else if (r.status === 'ABSENT') c.absent += 1;
    else if (r.status === 'LEAVE') c.leave += 1;
    else c.notSet += 1;
  }
  return c;
}

// True when any status differs from what was loaded (guards leaving with unsaved changes).
export function isDirty(rows: Row[], baseline: Row[]): boolean {
  if (rows.length !== baseline.length) return true;
  const was = new Map(baseline.map((r) => [r.studentId, r.status]));
  return rows.some((r) => was.get(r.studentId) !== r.status);
}

// null when nothing is marked: the API rejects an empty entry list.
export function buildSavePayload(
  params: Record<string, unknown>,
  academicYearId: number | null,
  date: string,
  rows: Row[],
): Record<string, unknown> | null {
  const entries = rows
    .filter((r) => r.status !== 'NOT_SET')
    .map((r) => ({ student_id: r.studentId, status: r.status }));
  if (entries.length === 0) return null;
  return { ...params, ...(academicYearId ? { academic_year: academicYearId } : {}), date, entries };
}

// With no argument: today on the school's calendar (School.timezone). A Date passed in is
// formatted as-is, which is what the tests and date pickers need.
export function todayString(now?: Date): string {
  return now ? format(now, 'yyyy-MM-dd') : schoolToday();
}

// yyyy-MM-dd strings compare correctly as text.
export function isFutureDate(date: string, today: string = todayString()): boolean {
  return date > today;
}
