import {
  buildExamPayload, emptyExamForm, examToForm, marksProgress, populateText, statusTone, validateExam, type ExamRow,
} from '../services/examsAdmin';

const ok = { ...emptyExamForm(), name: 'Midterm', examType: 2, classObj: 5 };

describe('exam form', () => {
  it('needs a name, a type, a class, ordered dates and a positive fail threshold', () => {
    expect(validateExam({ ...ok, name: ' ' })).toMatch(/name/);
    expect(validateExam({ ...ok, examType: null })).toMatch(/type/);
    expect(validateExam({ ...ok, classObj: null })).toMatch(/class/);
    expect(validateExam({ ...ok, start: '2026-12-10', end: '2026-12-01' })).toMatch(/on or after/);
    expect(validateExam({ ...ok, failThreshold: '0' })).toMatch(/1 or more/);
    expect(validateExam({ ...ok, failThreshold: 'x' })).toMatch(/1 or more/);
    expect(validateExam(ok)).toBeNull();
  });
  it('sends class and year only when creating', () => {
    expect(buildExamPayload({ ...ok, start: '2026-12-01', end: '2026-12-10', term: 3 }, 7, true)).toEqual({
      name: 'Midterm', exam_type: 2, term: 3, start_date: '2026-12-01', end_date: '2026-12-10', status: 'SCHEDULED',
      fail_threshold_subjects: 3, class_obj: 5, academic_year: 7,
    });
    const edit = buildExamPayload(ok, 7, false);
    expect(edit).not.toHaveProperty('class_obj');
    expect(edit).not.toHaveProperty('academic_year');
    expect(edit).toMatchObject({ start_date: null, end_date: null });
  });
  it('round-trips an exam', () => {
    const e: ExamRow = { id: 1, name: 'Final', academic_year: 7, term: null, exam_type: 2, class_obj: 5, start_date: '2026-12-01', end_date: null, status: 'MARKS_ENTRY', fail_threshold_subjects: 2 };
    expect(examToForm(e)).toMatchObject({ name: 'Final', examType: 2, classObj: 5, start: '2026-12-01', end: '', status: 'MARKS_ENTRY', failThreshold: '2' });
  });
});

describe('wording', () => {
  it('describes marks progress', () => {
    expect(marksProgress({ marks_entered_count: 12, marks_expected_count: 40, subjects_count: 4 })).toBe('12 of 40 marks entered');
    expect(marksProgress({ marks_expected_count: 0, subjects_count: 6 })).toBe('6 subjects');
    expect(marksProgress({})).toBe('No subjects yet');
  });
  it('explains the subject sync', () => {
    expect(populateText({ added_count: 3, total_count: 8 })).toBe('3 subjects added (8 in total).');
    expect(populateText({ added_count: 1, total_count: 1 })).toBe('1 subject added (1 in total).');
    expect(populateText({ added_count: 0, total_count: 8 })).toBe('Subjects are up to date (8).');
    expect(populateText({ added_count: 0, total_count: 0 })).toMatch(/No subjects are assigned/);
  });
  it('colours the lifecycle', () => {
    expect(['SCHEDULED', 'IN_PROGRESS', 'MARKS_ENTRY', 'COMPLETED', 'PUBLISHED'].map(statusTone)).toEqual(['neutral', 'info', 'warning', 'success', 'success']);
  });
});
