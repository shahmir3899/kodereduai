// Classes and sections for admin and principal: the sections of the active academic year (session
// classes) and, when a year has none yet, the school's master classes. Port of the web
// ClassesGradesPage without its section allocator. Pure logic, no React Native imports.
// See CLASS_SYSTEM_GUIDE.md: a session class links to a section-free master class, and the master
// class carries history across years, so naming and linking follow the web exactly.

export const GRADE_PRESETS = [
  { name: 'Playgroup', level: 0 }, { name: 'Nursery', level: 1 }, { name: 'Prep', level: 2 }, { name: 'Class 1', level: 3 }, { name: 'Class 2', level: 4 },
  { name: 'Class 3', level: 5 }, { name: 'Class 4', level: 6 }, { name: 'Class 5', level: 7 }, { name: 'Class 6', level: 8 }, { name: 'Class 7', level: 9 },
  { name: 'Class 8', level: 10 }, { name: 'Class 9', level: 11 }, { name: 'Class 10', level: 12 },
];
export const GRADE_LEVEL_LABELS: Record<number, string> = Object.fromEntries(GRADE_PRESETS.map((p) => [p.level, p.name]));
export const SECTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

export interface MasterClass { id: number; name: string; section?: string | null; grade_level: number | string; is_active: boolean; student_count?: number }
export interface SessionClassRow {
  id: number; academic_year: number; class_obj: number | null; display_name: string; section?: string | null;
  grade_level: number | string; label?: string; enrollment_count?: number; unassigned_count?: number; is_active: boolean;
}

export interface ClassForm { name: string; grade: string; section: string }
export const emptyClassForm = (): ClassForm => ({ name: '', grade: '', section: '' });

export const masterToForm = (c: MasterClass): ClassForm => ({ name: c.name, grade: String(c.grade_level ?? ''), section: c.section ?? '' });
export const sessionToForm = (c: SessionClassRow): ClassForm => ({ name: c.display_name, grade: String(c.grade_level ?? ''), section: c.section ?? '' });

// Choosing a grade level fills the standard name (Class 3 for level 5); a level with no standard
// name keeps what was typed.
export function withGrade(f: ClassForm, grade: string): ClassForm {
  const label = GRADE_LEVEL_LABELS[Number(grade)];
  return { ...f, grade, name: label ?? f.name };
}

export function validateClassForm(f: ClassForm): string | null {
  if (!f.name.trim()) return 'Enter the class name.';
  if (f.grade.trim() !== '' && !/^\d+$/.test(f.grade.trim())) return 'Grade level must be a whole number.';
  return null;
}

// Section-free master classes only: those are what a session class may link to.
export const canonicalMasters = (masters: MasterClass[]) => masters.filter((m) => !String(m.section ?? '').trim());

export function linkedMaster(masters: MasterClass[], name: string, grade: number): MasterClass | null {
  return canonicalMasters(masters).find((m) => m.name.trim().toLowerCase() === name.trim().toLowerCase() && Number(m.grade_level) === Number(grade)) ?? null;
}

const levelOf = (f: ClassForm) => (f.grade.trim() === '' ? 0 : Number(f.grade));

export function buildMasterPayload(f: ClassForm, schoolId: number, creating: boolean) {
  // A new master class never has a section (sections live on the year); an edit keeps the old one.
  return { ...(creating ? { school: schoolId } : {}), name: f.name.trim(), section: creating ? '' : f.section.trim(), grade_level: levelOf(f) };
}

export function buildSessionPayload(f: ClassForm, yearId: number, masters: MasterClass[]) {
  return {
    academic_year: yearId, class_obj: linkedMaster(masters, f.name, levelOf(f))?.id ?? null,
    display_name: f.name.trim(), section: f.section.trim(), grade_level: levelOf(f),
  };
}

// Sections still missing for a grade level, so quick-add never repeats one.
export function missingSections(existing: SessionClassRow[], name: string, wanted: string[]): string[] {
  const have = new Set(existing.filter((c) => c.display_name.trim().toLowerCase() === name.trim().toLowerCase()).map((c) => String(c.section ?? '').trim().toLowerCase()));
  return wanted.filter((s) => !have.has(s.trim().toLowerCase()));
}

export const classLabel = (c: Pick<SessionClassRow, 'display_name' | 'section' | 'label'>) =>
  c.label || (String(c.section ?? '').trim() ? `${c.display_name} - ${c.section}` : c.display_name);

export function sortSessionClasses(rows: SessionClassRow[]): SessionClassRow[] {
  return [...rows].sort((a, b) => (Number(a.grade_level) || 0) - (Number(b.grade_level) || 0) || classLabel(a).localeCompare(classLabel(b)));
}

export const sessionSubtitle = (c: SessionClassRow) => {
  const n = c.enrollment_count ?? 0;
  const parts = [`${n} student${n === 1 ? '' : 's'}`];
  if ((c.unassigned_count ?? 0) > 0) parts.push(`${c.unassigned_count} without a section`);
  if (c.class_obj == null) parts.push('not linked to a master class');
  return parts.join('  ·  ');
};

// A class with students cannot be removed without losing history; say so before asking the server.
export const deleteWarning = (name: string, students: number) =>
  students > 0 ? `${name} has ${students} student${students === 1 ? '' : 's'}. The server may refuse; move them first.` : name;
