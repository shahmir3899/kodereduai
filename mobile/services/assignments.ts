// Pure logic for the Assignments screens; port of frontend/src/pages/lms/AssignmentsPage.jsx,
// assignmentFilters.js and SubmissionReviewPage.jsx.

export type AssignmentType = 'HOMEWORK' | 'DIARY' | 'PROJECT' | 'CLASSWORK' | 'LAB';
export type AssignmentStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';

export const ASSIGNMENT_TYPES: AssignmentType[] = ['HOMEWORK', 'DIARY', 'PROJECT', 'CLASSWORK', 'LAB'];
// DIARY is created from "Create Daily Diary" on the web, not the single-assignment form (it can
// still be edited here).
export const SINGLE_FORM_TYPES = ASSIGNMENT_TYPES.filter((t) => t !== 'DIARY');
export const STATUSES: AssignmentStatus[] = ['DRAFT', 'PUBLISHED', 'CLOSED'];

export const TYPE_HELP: Record<AssignmentType, string> = {
  HOMEWORK: 'Student task. Requires submission and can be graded.',
  DIARY: 'Daily class note or instruction. Read-only for students: no submission, no grading.',
  PROJECT: 'Larger multi-day deliverable. Submission and grading enabled.',
  CLASSWORK: 'In-class activity record. Submission optional.',
  LAB: 'Practical activity with observations. Submission optional.',
};

export interface Assignment {
  id: number;
  title: string;
  description?: string;
  instructions?: string;
  class_obj: number;
  session_class?: number | null;
  class_name?: string;
  subject: number;
  subject_name?: string;
  teacher?: number | null;
  assignment_type: AssignmentType;
  requires_submission: boolean;
  due_date?: string | null;
  total_marks?: number | null;
  attachments_allowed?: boolean;
  status: AssignmentStatus;
  submission_count?: number;
}

export interface Filters {
  masterClassId?: number | null;
  sessionClassId?: number | null;
  sessionScoped?: boolean;
  subject?: number | null;
  status?: string;
  type?: string;
  search?: string;
}

// The whole year is fetched once and filtered here, so changing a filter costs no API call.
export function filterAssignments(list: Assignment[], f: Filters): Assignment[] {
  const q = (f.search || '').trim().toLowerCase();
  return list.filter((a) => {
    if (f.masterClassId && a.class_obj !== f.masterClassId) return false;
    // Whole-class assignments plus this section's own, not a sibling's.
    if (f.sessionScoped && f.sessionClassId && a.session_class != null && a.session_class !== f.sessionClassId) return false;
    if (f.subject && a.subject !== f.subject) return false;
    if (f.status && a.status !== f.status) return false;
    if (f.type && a.assignment_type !== f.type) return false;
    if (q && !a.title?.toLowerCase().includes(q)) return false;
    return true;
  });
}

// Past due and still open for work. Diaries have a date, not a deadline.
export function isOverdue(a: Pick<Assignment, 'due_date' | 'status' | 'assignment_type'>, today: string): boolean {
  if (a.assignment_type === 'DIARY' || !a.due_date || a.status === 'CLOSED') return false;
  return a.due_date < today;
}

// A section of a class split into several sections gets section-only assignments; the only
// section of a class keeps whole-class ones (session_class null).
export function splitSectionId(
  sessionClassId: number | null,
  sessionClasses: Array<{ id: number; class_obj?: number | null }>,
): number | null {
  if (!sessionClassId) return null;
  const sc = sessionClasses.find((c) => c.id === sessionClassId);
  if (!sc?.class_obj) return null;
  const siblings = sessionClasses.filter((c) => c.class_obj === sc.class_obj);
  return siblings.length > 1 ? sessionClassId : null;
}

export interface AssignmentForm {
  title: string;
  description: string;
  instructions: string;
  // The picked class option's id: a session class, or a master class when the year has none.
  classId: number | null;
  subject: number | null;
  teacher: number | null;
  assignment_type: AssignmentType;
  requires_submission: boolean;
  due_date: string;
  total_marks: string;
  attachments_allowed: boolean;
  status: AssignmentStatus;
}

export function emptyForm(): AssignmentForm {
  return {
    title: '', description: '', instructions: '', classId: null, subject: null, teacher: null,
    assignment_type: 'HOMEWORK', requires_submission: true, due_date: '', total_marks: '100',
    attachments_allowed: true, status: 'DRAFT',
  };
}

// `classId` is the option id the class Select uses: the section when the assignment has one,
// else the master class's session class (when the year has session classes), else the master id.
export function formFromAssignment(
  a: Assignment,
  sessionClasses: Array<{ id: number; class_obj?: number | null }>,
  useSession: boolean,
): AssignmentForm {
  let classId: number | null = a.class_obj;
  if (useSession) {
    classId = a.session_class ?? sessionClasses.find((c) => c.class_obj === a.class_obj)?.id ?? null;
  }
  return {
    title: a.title || '',
    description: a.description || '',
    instructions: a.instructions || '',
    classId,
    subject: a.subject || null,
    teacher: a.teacher ?? null,
    assignment_type: a.assignment_type || 'HOMEWORK',
    requires_submission: a.requires_submission ?? true,
    due_date: a.due_date || '',
    total_marks: String(a.total_marks ?? 100),
    attachments_allowed: a.attachments_allowed ?? true,
    status: a.status || 'DRAFT',
  };
}

// A diary is read-only for students, so it never asks for a submission or a due date.
export function setType(form: AssignmentForm, type: AssignmentType): AssignmentForm {
  const diary = type === 'DIARY';
  return {
    ...form,
    assignment_type: type,
    requires_submission: diary ? false : form.requires_submission,
    due_date: diary ? '' : form.due_date,
  };
}

// First problem found, in the order the web checks them; null when the form is fine.
export function validateForm(f: AssignmentForm): string | null {
  if (!f.title.trim()) return 'Title is required';
  if (!f.classId) return 'Please select a class';
  if (!f.subject) return 'Please select a subject';
  if (!f.teacher) return 'Please select a teacher';
  if (!f.description.trim()) return 'Description is required';
  if (f.assignment_type !== 'DIARY' && f.requires_submission && !f.due_date) {
    return 'Due date is required for submission-based assignments';
  }
  return null;
}

export function buildPayload(input: {
  form: AssignmentForm;
  masterClassId: number;
  sessionClassId: number | null;
  academicYearId?: number | null;
}) {
  const { form } = input;
  return {
    title: form.title.trim(),
    description: form.description,
    instructions: form.instructions,
    class_obj: input.masterClassId,
    session_class: input.sessionClassId,
    subject: form.subject,
    teacher: form.teacher,
    assignment_type: form.assignment_type,
    requires_submission: form.requires_submission,
    due_date: form.due_date || null,
    total_marks: parseInt(form.total_marks, 10) || 100,
    attachments_allowed: form.attachments_allowed,
    status: form.status,
    ...(input.academicYearId ? { academic_year: input.academicYearId } : {}),
  };
}

// The teacher a new assignment defaults to: the signed-in teacher's own staff record, found by
// user id, else the teacher on their timetable entries. null when neither is known (admins).
export function resolveDefaultTeacherId(
  staff: Array<{ id: number; user?: number | null }>,
  userId: number | undefined,
  timetableTeacherId: number | null | undefined,
): number | null {
  const mine = userId != null ? staff.find((s) => s.user === userId) : undefined;
  return mine?.id ?? timetableTeacherId ?? null;
}

// First field error from a DRF 400, so the toast says what is wrong instead of "failed".
export function firstFieldError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const first = Object.entries(data as Record<string, unknown>).find(([, v]) => Array.isArray(v) && v.length);
  return first ? `${first[0].replace(/_/g, ' ')}: ${(first[1] as unknown[])[0]}` : null;
}

export const canPublish = (a: Pick<Assignment, 'status'>) => a.status === 'DRAFT';
export const canClose = (a: Pick<Assignment, 'status'>) => a.status === 'PUBLISHED';

export interface Submission {
  id: number;
  student: number;
  student_name: string;
  status: 'PENDING' | 'SUBMITTED' | 'LATE' | 'GRADED' | 'RETURNED';
  submitted_at?: string | null;
  submission_text?: string | null;
  file_url?: string | null;
  marks_obtained?: number | string | null;
  feedback?: string | null;
}

export function submissionStats(subs: Submission[]) {
  const count = (...s: Submission['status'][]) => subs.filter((x) => s.includes(x.status)).length;
  return {
    total: subs.length,
    submitted: count('SUBMITTED', 'LATE'),
    graded: count('GRADED'),
    returned: count('RETURNED'),
    pending: count('PENDING'),
    late: count('LATE'),
  };
}

// null when fine. The server rejects the same cases, but a phone should say so before sending.
export function validateGrade(marks: string, total: number | null | undefined): string | null {
  if (marks.trim() === '') return 'Please enter marks';
  const n = parseFloat(marks);
  if (Number.isNaN(n) || n < 0) return 'Marks must be a non-negative number';
  if (total && n > total) return `Marks cannot exceed total marks (${total})`;
  return null;
}

// Every submission can be marked (the web does not hide Grade on pending ones); a graded one is
// re-graded, and only a graded one can be returned to the student.
export const gradeLabel = (s: Pick<Submission, 'status'>) => (s.status === 'GRADED' ? 'Re-grade' : 'Grade');
export const canReturn = (s: Pick<Submission, 'status'>) => s.status === 'GRADED';

export function truncate(text: string | null | undefined, max = 140): string {
  if (!text) return '';
  return text.length <= max ? text : `${text.substring(0, max)}…`;
}
