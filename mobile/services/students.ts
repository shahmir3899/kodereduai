import type { ClassOption } from './attendanceEntry';

// Pure logic for the read-only Students and Classes screens. The server scopes every list to what
// the signed-in role may see (a teacher gets their own sections), so nothing here filters access.

export interface StudentRow {
  id: number;
  name: string;
  roll_number?: string | null;
  class_name?: string | null;
  photo_url?: string | null;
  status?: string | null;
  parent_name?: string | null;
}

// Query params for the students list: a section (session class) when the year has them, else the
// master class, plus the search term. No class means every student the role may see.
export function studentListParams(input: {
  term: string;
  option: ClassOption | null;
  academicYearId: number | null;
  page: number;
  pageSize?: number;
}): Record<string, unknown> {
  const { option } = input;
  const scope = !option ? {}
    : option.isSession && input.academicYearId ? { session_class_id: option.id, academic_year: input.academicYearId }
    : { class_id: option.classObj ?? option.id };
  return {
    page: input.page,
    page_size: input.pageSize ?? 30,
    ...scope,
    ...(input.term.trim() ? { search: input.term.trim() } : {}),
  };
}

export function statusTone(status?: string | null): 'success' | 'warning' | 'error' | 'neutral' {
  switch ((status || '').toUpperCase()) {
    case 'ACTIVE': return 'success';
    case 'GRADUATED': case 'ALUMNI': return 'neutral';
    case 'WITHDRAWN': case 'TRANSFERRED': case 'EXPELLED': return 'error';
    default: return 'warning';
  }
}

export const statusLabel = (status?: string | null) => (status ? status[0] + status.slice(1).toLowerCase() : '');

export interface ProfileSummary {
  attendance_rate?: number | null;
  present_days?: number;
  total_absent?: number;
  total_leave?: number;
  total_days?: number;
  pending_fee?: number;
  exam_average?: number | null;
  exam_average_label?: string | null;
}

export interface StatCardData { label: string; value: string; tone: 'success' | 'warning' | 'error' | 'neutral' }

// The headline cards on a profile. The fee card shows what is still owed only: the summary's
// total due and total paid are plain sums that don't line up with the ledger (see
// docs/PHASE5_KNOWN_FAILURES.md), so they are not shown.
export function summaryCards(s: ProfileSummary | null | undefined, showFees: boolean): StatCardData[] {
  if (!s) return [];
  const cards: StatCardData[] = [];
  const rate = s.attendance_rate;
  cards.push({
    label: 'Attendance',
    value: rate == null ? '—' : `${Math.round(rate)}%`,
    tone: rate == null ? 'neutral' : rate >= 90 ? 'success' : rate >= 75 ? 'warning' : 'error',
  });
  cards.push({
    label: s.exam_average_label || 'Exam average',
    value: s.exam_average == null ? '—' : `${Math.round(Number(s.exam_average) * 10) / 10}%`,
    tone: 'neutral',
  });
  if (showFees) {
    const owed = Number(s.pending_fee ?? 0);
    cards.push({ label: 'Fees pending', value: `PKR ${Math.round(owed).toLocaleString()}`, tone: owed > 0 ? 'error' : 'success' });
  }
  return cards;
}

export interface InfoRow { label: string; value: string }

// Details worth showing, skipping anything empty so the card doesn't fill with dashes.
export function infoRows(s: Record<string, unknown> | null | undefined): InfoRow[] {
  if (!s) return [];
  const fields: Array<[string, string]> = [
    ['Admission no.', 'admission_number'], ['Roll no.', 'roll_number'], ['Class', 'class_name'], ['Gender', 'gender'],
    ['Date of birth', 'date_of_birth'], ['Admission date', 'admission_date'], ['Parent / guardian', 'parent_name'],
    ['Parent phone', 'parent_phone'], ['Guardian phone', 'guardian_phone'], ['Emergency contact', 'emergency_contact'],
    ['Address', 'address'], ['School', 'school_name'],
  ];
  return fields
    .map(([label, key]) => ({ label, value: s[key] == null ? '' : String(s[key]).trim() }))
    .filter((r) => r.value !== '');
}

export interface MonthAttendance { month: string | null; present: number; absent: number; late: number; leave: number; total: number; rate: number | null }

export function monthLine(m: MonthAttendance): string {
  const parts = [`P ${m.present}`, `A ${m.absent}`];
  if (m.late) parts.push(`Late ${m.late}`);
  if (m.leave) parts.push(`L ${m.leave}`);
  return parts.join('  ·  ');
}

// A class section, for the Classes screen.
export interface SectionRow { id: number; label: string; grade: number; students: number; classObj: number | null }

interface SessionClassDto {
  id: number; class_obj?: number | null; display_name?: string; class_obj_name?: string; label?: string;
  section?: string; grade_level?: number | string; enrollment_count?: number; is_active?: boolean;
}

// The sections to list: active ones, limited to the given master classes when the caller is a
// teacher (null means everything), in grade order.
export function sectionRows(sessionClasses: SessionClassDto[], allowedMasterIds: Set<number> | null): SectionRow[] {
  return sessionClasses
    .filter((sc) => sc.is_active !== false && (!allowedMasterIds || allowedMasterIds.has(Number(sc.class_obj))))
    .map((sc) => {
      const name = sc.display_name || sc.class_obj_name || `Class ${sc.class_obj}`;
      const section = String(sc.section || '').trim();
      return {
        id: sc.id,
        label: sc.label || (section ? `${name} - ${section}` : name),
        grade: Number(sc.grade_level) || 0,
        students: sc.enrollment_count ?? 0,
        classObj: sc.class_obj ?? null,
      };
    })
    .sort((a, b) => a.grade - b.grade || a.label.localeCompare(b.label));
}
