// Pure logic for creating and editing exams; port of the rules in backend/examinations/serializers.py
// (ExamCreateSerializer) and the Exams page. Admin and principal only. One exam per WHOLE class
// (class_obj, every section); section-only exams, exam groups and the date sheet wizard stay on the web.

export const EXAM_STATUSES = [
  { value: 'SCHEDULED', label: 'Scheduled' }, { value: 'IN_PROGRESS', label: 'In progress' }, { value: 'MARKS_ENTRY', label: 'Marks entry' },
  { value: 'COMPLETED', label: 'Completed' }, { value: 'PUBLISHED', label: 'Published' },
] as const;

export function statusTone(status: string): 'neutral' | 'info' | 'warning' | 'success' {
  return status === 'SCHEDULED' ? 'neutral' : status === 'IN_PROGRESS' ? 'info' : status === 'MARKS_ENTRY' ? 'warning' : 'success';
}

export interface ExamRow {
  id: number;
  name: string;
  academic_year: number;
  term?: number | null;
  term_name?: string | null;
  exam_type: number;
  exam_type_name?: string;
  class_obj: number;
  session_class?: number | null;
  class_name?: string;
  exam_group_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status: string;
  subjects_count?: number;
  marks_entered_count?: number;
  marks_expected_count?: number;
  marks_entry_complete?: boolean;
  fail_threshold_subjects: number;
}

export interface ExamForm {
  name: string;
  examType: number | null;
  classObj: number | null;
  term: number | null;
  start: string;
  end: string;
  status: string;
  failThreshold: string;
}

export const emptyExamForm = (): ExamForm => ({ name: '', examType: null, classObj: null, term: null, start: '', end: '', status: 'SCHEDULED', failThreshold: '3' });

export const examToForm = (e: ExamRow): ExamForm => ({
  name: e.name, examType: e.exam_type, classObj: e.class_obj, term: e.term ?? null, start: e.start_date ?? '', end: e.end_date ?? '',
  status: e.status, failThreshold: String(e.fail_threshold_subjects),
});

// Marks progress as a short phrase, for example "12 of 40 marks entered".
export function marksProgress(e: Pick<ExamRow, 'marks_entered_count' | 'marks_expected_count' | 'subjects_count'>): string {
  const expected = e.marks_expected_count ?? 0;
  if (expected <= 0) return e.subjects_count ? `${e.subjects_count} subjects` : 'No subjects yet';
  return `${e.marks_entered_count ?? 0} of ${expected} marks entered`;
}

export function validateExam(f: ExamForm): string | null {
  if (!f.name.trim()) return 'Enter the exam name.';
  if (!f.examType) return 'Choose the exam type.';
  if (!f.classObj) return 'Choose the class.';
  if (f.start && f.end && f.end < f.start) return 'The end date must be on or after the start date.';
  if (!/^\d+$/.test(f.failThreshold.trim()) || Number(f.failThreshold) < 1) return 'Enter how many failed subjects fail the exam (1 or more).';
  return null;
}

export function buildExamPayload(f: ExamForm, academicYearId: number, creating: boolean) {
  return {
    name: f.name.trim(),
    exam_type: f.examType,
    term: f.term,
    start_date: f.start || null,
    end_date: f.end || null,
    status: f.status,
    fail_threshold_subjects: Number(f.failThreshold),
    // Class and year are fixed once an exam exists (marks hang off them).
    ...(creating ? { class_obj: f.classObj, academic_year: academicYearId } : {}),
  };
}

export function populateText(r: { added_count?: number; total_count?: number } | undefined): string {
  const added = r?.added_count ?? 0;
  const total = r?.total_count ?? 0;
  if (total === 0) return 'No subjects are assigned to this class yet, so the exam has none. Assign subjects to the class on the web, then use Sync subjects.';
  return added > 0 ? `${added} subject${added === 1 ? '' : 's'} added (${total} in total).` : `Subjects are up to date (${total}).`;
}
