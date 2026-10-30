// Pure logic for monthly student assessments; port of frontend/src/pages/academics/AssessmentsPage.jsx.

export const SKILL_FIELDS = [
  ['listening', 'Listening'],
  ['speaking', 'Speaking'],
  ['writing', 'Writing'],
  ['reading', 'Reading'],
  ['participation', 'Participation'],
  ['confidence', 'Confidence'],
  ['social_skills', 'Social Skills'],
] as const;

export const BEHAVIOUR_FIELDS = [
  ['discipline', 'Discipline'],
  ['respect', 'Respect'],
  ['teamwork', 'Teamwork'],
  ['class_participation', 'Class Participation'],
  ['responsibility', 'Responsibility'],
] as const;

export const RATING_LABELS: Record<number, string> = {
  1: 'Needs Improvement', 2: 'Fair', 3: 'Good', 4: 'Very Good', 5: 'Excellent',
};

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export type RatingField = (typeof SKILL_FIELDS)[number][0] | (typeof BEHAVIOUR_FIELDS)[number][0];
const RATING_KEYS: RatingField[] = [...SKILL_FIELDS, ...BEHAVIOUR_FIELDS].map(([k]) => k);

// A rating is 1..5, or null when not given yet.
export type AssessmentForm = Record<RatingField, number | null> & { teacher_remark: string; principal_remark: string };

export interface RosterRow extends Partial<Record<RatingField, number | null>> {
  student: number;
  student_name: string;
  roll_number?: string | null;
  teacher_remark?: string | null;
  principal_remark?: string | null;
}

export function monthOptions(): Array<{ value: number; label: string }> {
  return MONTH_NAMES.map((label, i) => ({ value: i + 1, label }));
}

export function emptyForm(): AssessmentForm {
  const form = { teacher_remark: '', principal_remark: '' } as AssessmentForm;
  for (const k of RATING_KEYS) form[k] = null;
  return form;
}

export function formFromRow(row: RosterRow): AssessmentForm {
  const form = emptyForm();
  for (const k of RATING_KEYS) form[k] = row[k] ?? null;
  form.teacher_remark = row.teacher_remark || '';
  form.principal_remark = row.principal_remark || '';
  return form;
}

// Tapping the current rating clears it, so a slip is undoable.
export function toggleRating(form: AssessmentForm, field: RatingField, value: number): AssessmentForm {
  return { ...form, [field]: form[field] === value ? null : value };
}

export function ratedCount(form: AssessmentForm): number {
  return RATING_KEYS.filter((k) => form[k] != null).length;
}

export const TOTAL_RATINGS = RATING_KEYS.length;

export function formsEqual(a: AssessmentForm, b: AssessmentForm): boolean {
  return RATING_KEYS.every((k) => a[k] === b[k])
    && a.teacher_remark === b.teacher_remark
    && a.principal_remark === b.principal_remark;
}

// Students whose form differs from what the server last gave us.
export function changedStudents(
  roster: RosterRow[], edits: Record<number, AssessmentForm>,
): number[] {
  return roster
    .filter((row) => edits[row.student] && !formsEqual(edits[row.student], formFromRow(row)))
    .map((row) => row.student);
}

// Only teachers cannot write the principal's remark.
export function canEditPrincipalRemark(role: string | undefined, isSuperAdmin: boolean): boolean {
  return isSuperAdmin || role !== 'TEACHER';
}

export function buildAssessmentPayload(studentId: number, form: AssessmentForm, canEditPrincipal: boolean) {
  const out: Record<string, unknown> = { student: studentId };
  for (const k of RATING_KEYS) out[k] = form[k];
  out.teacher_remark = form.teacher_remark || '';
  out.principal_remark = canEditPrincipal ? (form.principal_remark || '') : '';
  return out;
}

// Only the students that changed are sent: sending the whole class would write empty
// assessments for children nobody rated.
export function buildBulkPayload(input: {
  academicYearId: number;
  month: number;
  sessionClassId: number | null;
  classObjId: number | null;
  roster: RosterRow[];
  edits: Record<number, AssessmentForm>;
  canEditPrincipal: boolean;
}) {
  const ids = new Set(changedStudents(input.roster, input.edits));
  return {
    academic_year: input.academicYearId,
    month: input.month,
    ...(input.sessionClassId ? { session_class: input.sessionClassId } : {}),
    ...(input.classObjId ? { class_obj: input.classObjId } : {}),
    assessments: input.roster
      .filter((r) => ids.has(r.student))
      .map((r) => buildAssessmentPayload(r.student, input.edits[r.student], input.canEditPrincipal)),
  };
}
