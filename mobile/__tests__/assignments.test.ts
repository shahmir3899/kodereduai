import {
  buildPayload, canClose, canPublish, canReturn, emptyForm, filterAssignments, firstFieldError, formFromAssignment,
  gradeLabel, isOverdue, resolveDefaultTeacherId, setType, splitSectionId, submissionStats, truncate, validateForm,
  validateGrade, type Assignment, type Submission,
} from '../services/assignments';

const a = (id: number, extra: Partial<Assignment> = {}): Assignment => ({
  id, title: `Task ${id}`, class_obj: 5, subject: 10, assignment_type: 'HOMEWORK', requires_submission: true, status: 'DRAFT', ...extra,
});

describe('filterAssignments', () => {
  const list = [
    a(1, { class_obj: 5, session_class: 11, status: 'PUBLISHED', title: 'Algebra homework' }),
    a(2, { class_obj: 5, session_class: 12, subject: 11 }),
    a(3, { class_obj: 5, session_class: null, assignment_type: 'LAB' }),
    a(4, { class_obj: 6 }),
  ];

  it('filters by class, status, type, subject and title', () => {
    expect(filterAssignments(list, { masterClassId: 6 }).map((x) => x.id)).toEqual([4]);
    expect(filterAssignments(list, { status: 'PUBLISHED' }).map((x) => x.id)).toEqual([1]);
    expect(filterAssignments(list, { type: 'LAB' }).map((x) => x.id)).toEqual([3]);
    expect(filterAssignments(list, { subject: 11 }).map((x) => x.id)).toEqual([2]);
    expect(filterAssignments(list, { search: ' ALGEBRA ' }).map((x) => x.id)).toEqual([1]);
  });

  it('shows a section its own assignments plus whole-class ones, not a sibling section', () => {
    const ids = filterAssignments(list, { masterClassId: 5, sessionClassId: 11, sessionScoped: true }).map((x) => x.id);
    expect(ids).toEqual([1, 3]);
    expect(filterAssignments(list, { masterClassId: 5, sessionClassId: 11, sessionScoped: false })).toHaveLength(3);
  });
});

describe('dates and status', () => {
  it('is overdue only when open, dated and past, and never for a diary', () => {
    expect(isOverdue(a(1, { due_date: '2026-10-01' }), '2026-10-28')).toBe(true);
    expect(isOverdue(a(1, { due_date: '2026-10-28' }), '2026-10-28')).toBe(false);
    expect(isOverdue(a(1, { due_date: '2026-10-01', status: 'CLOSED' }), '2026-10-28')).toBe(false);
    expect(isOverdue(a(1, { due_date: '2026-10-01', assignment_type: 'DIARY' }), '2026-10-28')).toBe(false);
    expect(isOverdue(a(1, { due_date: null }), '2026-10-28')).toBe(false);
  });

  it('publishes drafts and closes published ones only', () => {
    expect(canPublish({ status: 'DRAFT' })).toBe(true);
    expect(canPublish({ status: 'PUBLISHED' })).toBe(false);
    expect(canClose({ status: 'PUBLISHED' })).toBe(true);
    expect(canClose({ status: 'CLOSED' })).toBe(false);
  });
});

describe('sections', () => {
  const sessions = [
    { id: 11, class_obj: 5 }, { id: 12, class_obj: 5 }, { id: 21, class_obj: 6 },
  ];

  it('uses a section only when the class is split into several', () => {
    expect(splitSectionId(11, sessions)).toBe(11);
    expect(splitSectionId(21, sessions)).toBeNull();
    expect(splitSectionId(null, sessions)).toBeNull();
    expect(splitSectionId(99, sessions)).toBeNull();
  });

  it('maps an assignment back to the class option it belongs to', () => {
    expect(formFromAssignment(a(1, { class_obj: 5, session_class: 12 }), sessions, true).classId).toBe(12);
    expect(formFromAssignment(a(1, { class_obj: 6, session_class: null }), sessions, true).classId).toBe(21);
    expect(formFromAssignment(a(1, { class_obj: 5 }), [], false).classId).toBe(5);
  });
});

describe('form', () => {
  const ok = { ...emptyForm(), title: 'T', classId: 11, subject: 10, teacher: 3, description: 'Do it', due_date: '2026-11-01' };

  it('checks required fields in the web order', () => {
    expect(validateForm(emptyForm())).toBe('Title is required');
    expect(validateForm({ ...ok, classId: null })).toBe('Please select a class');
    expect(validateForm({ ...ok, subject: null })).toBe('Please select a subject');
    expect(validateForm({ ...ok, teacher: null })).toBe('Please select a teacher');
    expect(validateForm({ ...ok, description: '  ' })).toBe('Description is required');
    expect(validateForm({ ...ok, due_date: '' })).toBe('Due date is required for submission-based assignments');
    expect(validateForm(ok)).toBeNull();
  });

  it('does not need a due date without a submission, or for a diary', () => {
    expect(validateForm({ ...ok, due_date: '', requires_submission: false })).toBeNull();
    expect(validateForm(setType({ ...ok, due_date: '' }, 'DIARY'))).toBeNull();
  });

  it('turns a diary into a read-only, undated entry', () => {
    const diary = setType(ok, 'DIARY');
    expect(diary).toMatchObject({ assignment_type: 'DIARY', requires_submission: false, due_date: '' });
    expect(setType(diary, 'PROJECT').requires_submission).toBe(false);
  });

  it('builds the request body', () => {
    expect(buildPayload({ form: { ...ok, title: ' T ', total_marks: '40' }, masterClassId: 5, sessionClassId: 11, academicYearId: 7 }))
      .toMatchObject({ title: 'T', class_obj: 5, session_class: 11, subject: 10, teacher: 3, total_marks: 40, academic_year: 7, due_date: '2026-11-01' });
    const noYear = buildPayload({ form: { ...ok, total_marks: 'abc', due_date: '' }, masterClassId: 5, sessionClassId: null });
    expect(noYear).toMatchObject({ total_marks: 100, due_date: null, session_class: null });
    expect(noYear).not.toHaveProperty('academic_year');
  });

  it('defaults the teacher to the signed-in user, else the timetable teacher', () => {
    const staff = [{ id: 1, user: 50 }, { id: 2, user: 60 }];
    expect(resolveDefaultTeacherId(staff, 60, 9)).toBe(2);
    expect(resolveDefaultTeacherId(staff, 99, 9)).toBe(9);
    expect(resolveDefaultTeacherId([], 99, null)).toBeNull();
    expect(resolveDefaultTeacherId(staff, undefined, undefined)).toBeNull();
  });

  it('reads the first field error from a DRF 400', () => {
    expect(firstFieldError({ due_date: ['Required.'], title: ['x'] })).toBe('due date: Required.');
    expect(firstFieldError({ detail: 'nope' })).toBeNull();
    expect(firstFieldError(null)).toBeNull();
  });
});

describe('submissions', () => {
  const sub = (id: number, status: Submission['status']): Submission => ({ id, student: id, student_name: `S${id}`, status });

  it('counts each status, with late counted as submitted too', () => {
    const stats = submissionStats([sub(1, 'PENDING'), sub(2, 'SUBMITTED'), sub(3, 'LATE'), sub(4, 'GRADED'), sub(5, 'RETURNED')]);
    expect(stats).toEqual({ total: 5, submitted: 2, graded: 1, returned: 1, pending: 1, late: 1 });
  });

  it('validates marks against the total', () => {
    expect(validateGrade('', 20)).toBe('Please enter marks');
    expect(validateGrade('abc', 20)).toBe('Marks must be a non-negative number');
    expect(validateGrade('-1', 20)).toBe('Marks must be a non-negative number');
    expect(validateGrade('21', 20)).toBe('Marks cannot exceed total marks (20)');
    expect(validateGrade('20', 20)).toBeNull();
    expect(validateGrade('99', 0)).toBeNull();
  });

  it('re-grades a graded submission and returns only graded ones', () => {
    expect(gradeLabel(sub(1, 'GRADED'))).toBe('Re-grade');
    expect(gradeLabel(sub(1, 'SUBMITTED'))).toBe('Grade');
    expect(canReturn(sub(1, 'GRADED'))).toBe(true);
    expect(canReturn(sub(1, 'RETURNED'))).toBe(false);
  });

  it('shortens long text', () => {
    expect(truncate('a'.repeat(200), 10)).toBe('aaaaaaaaaa…');
    expect(truncate('short', 10)).toBe('short');
    expect(truncate(null)).toBe('');
  });
});
