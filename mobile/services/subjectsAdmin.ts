// Subjects, the subjects each class section studies (with the teacher and periods per week), and the
// class teacher of each section: port of the web SubjectsPage without its AI analysis tabs. Pure
// logic, no React Native imports. Admin and principal only (the server is read-only for others).

export interface Subject { id: number; name: string; code: string; description?: string | null; is_elective: boolean; is_active: boolean }

export interface SubjectForm { name: string; code: string; description: string; isElective: boolean; isActive: boolean }
export const emptySubjectForm = (): SubjectForm => ({ name: '', code: '', description: '', isElective: false, isActive: true });
export const subjectToForm = (s: Subject): SubjectForm => ({ name: s.name, code: s.code, description: s.description ?? '', isElective: s.is_elective, isActive: s.is_active });

export function validateSubject(f: SubjectForm): string | null {
  if (!f.name.trim()) return 'Enter the subject name.';
  if (!f.code.trim()) return 'Enter a short code, for example MATH.';
  if (f.code.trim().length > 20) return 'The code can be at most 20 characters.';
  return null;
}

// The server upper-cases the code and refuses a repeat inside the school. It does not accept
// is_active on create; a subject is switched off by editing it (the server deactivates on delete).
export function buildSubjectPayload(f: SubjectForm, creating: boolean) {
  const base = { name: f.name.trim(), code: f.code.trim().toUpperCase(), description: f.description.trim(), is_elective: f.isElective };
  return creating ? base : { ...base, is_active: f.isActive };
}

export const subjectSubtitle = (s: Subject) => [s.code, s.is_elective ? 'Elective' : null].filter(Boolean).join('  ·  ');

// ─── Subjects of a class section ────────────────────────────────────────────────────────────

export interface ClassSubjectRow {
  id: number;
  class_obj: number;
  session_class?: number | null;
  subject: number;
  subject_name: string;
  subject_code?: string;
  teacher?: number | null;
  teacher_name?: string | null;
  periods_per_week: number;
  academic_year?: number | null;
  is_active: boolean;
}

export interface ClassSubjectForm { subject: number | null; teacher: number | null; periods: string }
export const emptyClassSubjectForm = (): ClassSubjectForm => ({ subject: null, teacher: null, periods: '1' });
export const classSubjectToForm = (r: ClassSubjectRow): ClassSubjectForm => ({ subject: r.subject, teacher: r.teacher ?? null, periods: String(r.periods_per_week) });

export function validateClassSubject(f: ClassSubjectForm): string | null {
  if (f.subject == null) return 'Choose the subject.';
  if (!/^\d+$/.test(f.periods.trim()) || Number(f.periods) < 1 || Number(f.periods) > 20) return 'Periods per week must be a whole number from 1 to 20.';
  return null;
}

// A section of the active year is addressed by its session class; a year with no sections falls back
// to the master class. The academic year always goes with it (the server pairs them).
export interface Scope { sessionClass: number | null; classObj: number | null; academicYear: number | null }

export function buildClassSubjectPayload(f: ClassSubjectForm, scope: Scope) {
  return {
    ...(scope.sessionClass != null ? { session_class: scope.sessionClass } : { class_obj: scope.classObj }),
    ...(scope.academicYear != null ? { academic_year: scope.academicYear } : {}),
    subject: f.subject, teacher: f.teacher, periods_per_week: Number(f.periods),
  };
}

// Subjects not yet given to this section, so the picker cannot offer a repeat (the server refuses it).
export function unassignedSubjects(subjects: Subject[], assigned: ClassSubjectRow[], editingSubject: number | null = null): Subject[] {
  const taken = new Set(assigned.map((a) => a.subject));
  return subjects.filter((s) => s.is_active && (!taken.has(s.id) || s.id === editingSubject));
}

export const totalPeriods = (rows: ClassSubjectRow[]) => rows.filter((r) => r.is_active).reduce((n, r) => n + r.periods_per_week, 0);

export const classSubjectSubtitle = (r: ClassSubjectRow) =>
  [r.teacher_name || 'No teacher yet', `${r.periods_per_week} period${r.periods_per_week === 1 ? '' : 's'} a week`].join('  ·  ');

// ─── Class teachers ────────────────────────────────────────────────────────────────────────

export interface ClassTeacherRow { id: number; session_class: number | null; class_obj: number; teacher: number; teacher_name?: string | null; academic_year?: number | null; is_active: boolean }

export function validateClassTeacher(teacher: number | null, scope: Scope, existing: ClassTeacherRow[]): string | null {
  if (teacher == null) return 'Choose the teacher.';
  if (scope.sessionClass == null) return 'Class teachers are set per section. Add sections to this class first.';
  if (existing.some((c) => c.is_active && c.teacher === teacher && c.session_class === scope.sessionClass)) return 'This teacher is already the class teacher of this section.';
  return null;
}

export const buildClassTeacherPayload = (teacher: number, scope: Scope) => ({
  session_class: scope.sessionClass, teacher, ...(scope.academicYear != null ? { academic_year: scope.academicYear } : {}),
});
