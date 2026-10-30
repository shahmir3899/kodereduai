// Exam types and the grade scale: port of the web ExamTypesPage and GradeScalePage. Pure logic, no
// React Native imports, so Jest can load it.

export interface ExamTypeRow { id: number; name: string; weight: string | number; is_final?: boolean }
export interface ExamTypeForm { name: string; weight: string; isFinal: boolean }

export const emptyExamTypeForm = (): ExamTypeForm => ({ name: '', weight: '100', isFinal: false });
export const examTypeToForm = (t: ExamTypeRow): ExamTypeForm => ({ name: t.name, weight: String(t.weight ?? '100'), isFinal: !!t.is_final });

export function validateExamType(f: ExamTypeForm): string | null {
  if (!f.name.trim()) return 'Enter a name, for example Mid-Term.';
  const w = Number(f.weight);
  if (f.weight.trim() === '' || !Number.isFinite(w) || w < 0 || w > 100) return 'Weight must be between 0 and 100.';
  return null;
}

export const buildExamTypePayload = (f: ExamTypeForm) => ({ name: f.name.trim(), weight: Number(f.weight), is_final: f.isFinal });

export interface GradeRow { id: number; grade_label: string; min_percentage: string | number; max_percentage: string | number; gpa_points?: string | number | null; order?: number | null }
export interface GradeForm { label: string; min: string; max: string; gpa: string; order: string }

export const emptyGradeForm = (): GradeForm => ({ label: '', min: '', max: '', gpa: '', order: '' });
export const gradeToForm = (g: GradeRow): GradeForm => ({
  label: g.grade_label, min: String(g.min_percentage), max: String(g.max_percentage),
  gpa: g.gpa_points == null ? '' : String(g.gpa_points), order: g.order == null ? '' : String(g.order),
});

const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;

export function validateGrade(f: GradeForm): string | null {
  if (!f.label.trim()) return 'Enter the grade label, for example A+.';
  const min = Number(f.min), max = Number(f.max);
  if (f.min.trim() === '' || !inRange(min)) return 'Minimum % must be between 0 and 100.';
  if (f.max.trim() === '' || !inRange(max)) return 'Maximum % must be between 0 and 100.';
  if (min > max) return 'Minimum % cannot be higher than maximum %.';
  if (f.gpa.trim() !== '' && !Number.isFinite(Number(f.gpa))) return 'GPA points must be a number.';
  return null;
}

// A blank order or GPA goes to the API as 0: parseInt('') is NaN, which serialises to null and the
// API answers 400 with no message the user can act on (same fix as the web page).
export const buildGradePayload = (f: GradeForm) => ({
  grade_label: f.label.trim(),
  min_percentage: Number(f.min),
  max_percentage: Number(f.max),
  order: parseInt(f.order, 10) || 0,
  gpa_points: f.gpa.trim() === '' ? 0 : Number(f.gpa),
});

// Warnings about the whole scale, not blockers (the server decides what it accepts): two grades that
// cover the same marks, or marks that no grade covers, so a result could get no grade or two.
// Percentages are compared on whole-mark steps; a fractional boundary like 89.5 counts as covered.
export function scaleWarnings(grades: Array<Pick<GradeRow, 'grade_label' | 'min_percentage' | 'max_percentage'>>): string[] {
  const rows = grades
    .map((g) => ({ label: g.grade_label, min: Number(g.min_percentage), max: Number(g.max_percentage) }))
    .filter((g) => Number.isFinite(g.min) && Number.isFinite(g.max))
    .sort((a, b) => a.min - b.min || a.max - b.max);
  const out: string[] = [];
  if (rows.length === 0) return out;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].min < rows[i - 1].max) {
      out.push(`${rows[i - 1].label} and ${rows[i].label} overlap.`);
    }
  }
  let covered = rows[0].max;
  if (rows[0].min > 0) out.push(`No grade covers 0 to ${rows[0].min}%.`);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].min - covered > 1) out.push(`No grade covers ${covered}% to ${rows[i].min}%.`);
    covered = Math.max(covered, rows[i].max);
  }
  if (covered < 100) out.push(`No grade covers ${covered}% to 100%.`);
  return out;
}

export type GradeTone = 'success' | 'info' | 'warning' | 'error' | 'neutral';
export function gradeTone(label: string): GradeTone {
  const l = label.trim().toUpperCase();
  if (l.startsWith('A')) return 'success';
  if (l.startsWith('B')) return 'info';
  if (l.startsWith('C')) return 'warning';
  if (l.startsWith('D')) return 'warning';
  if (l === 'F') return 'error';
  return 'neutral';
}
