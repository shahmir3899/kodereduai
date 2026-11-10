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

describe('bulk delete of exams and groups', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require('../services/examsAdmin');
  it('toggles an id in and out of the selection', () => {
    expect(m.toggleId([1, 2], 3)).toEqual([1, 2, 3]);
    expect(m.toggleId([1, 2, 3], 2)).toEqual([1, 3]);
  });
  it('needs the word typed, in any case and with spaces around it', () => {
    expect(m.bulkDeleteTyped('delete')).toBe(true);
    expect(m.bulkDeleteTyped('  DELETE ')).toBe(true);
    expect(m.bulkDeleteTyped('del')).toBe(false);
    expect(m.bulkDeleteTyped('')).toBe(false);
  });
  it('warns that marks go too, with the right plurals', () => {
    expect(m.bulkDeleteText('exam', 1)).toMatch(/^1 exam will be deleted .*marks/);
    expect(m.bulkDeleteText('exam', 3)).toMatch(/^3 exams will be deleted/);
    expect(m.bulkDeleteText('group', 2)).toMatch(/2 exam groups will be deleted with every class exam in them/);
  });
  it('reports how many went, and how many were not found', () => {
    expect(m.bulkDeleteDone('exam', { deleted_count: 2 }, 2)).toBe('2 exams deleted.');
    expect(m.bulkDeleteDone('group', { deleted_count: 1 }, 3)).toBe('1 exam group deleted. 2 could not be found.');
    expect(m.bulkDeleteDone('exam', undefined, 1)).toBe('1 exam deleted.');
  });
});

describe('editing the subjects of an exam', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require('../services/examsAdmin');
  it('starts from the saved marks, else the web defaults', () => {
    expect(m.subjectToForm({ total_marks: '50.00', passing_marks: '20.00' })).toEqual({ total: '50', passing: '20' });
    expect(m.subjectToForm({})).toEqual({ total: '100', passing: '33' });
  });
  it('refuses empty, zero and passing above total', () => {
    expect(m.validateSubjectMarks({ total: '', passing: '33' })).toMatch(/total/i);
    expect(m.validateSubjectMarks({ total: '0', passing: '0' })).toMatch(/total/i);
    expect(m.validateSubjectMarks({ total: '50', passing: 'x' })).toMatch(/passing/i);
    expect(m.validateSubjectMarks({ total: '50', passing: '51' })).toMatch(/cannot be more/);
    expect(m.validateSubjectMarks({ total: '50', passing: '50' })).toBeNull();
    expect(m.validateSubjectMarks({ total: '100', passing: '33.5' })).toBeNull();
  });
  it('builds the save and add requests as numbers', () => {
    expect(m.subjectMarksPayload({ total: '80', passing: '30' })).toEqual({ total_marks: 80, passing_marks: 30 });
    expect(m.newSubjectPayload(7, 4, { total: '100', passing: '33' })).toEqual({ exam: 7, subject: 4, total_marks: 100, passing_marks: 33 });
  });
  it('offers only class subjects the exam lacks, each once', () => {
    const cls = [{ subject: 1 }, { subject: 2 }, { subject: 2 }, { subject: 3 }];
    expect(m.missingSubjects(cls, [{ subject: 1 }])).toEqual([{ subject: 2 }, { subject: 3 }]);
    expect(m.missingSubjects(cls, [{ subject: 1 }, { subject: 2 }, { subject: 3 }])).toEqual([]);
  });
  it('says marks are deleted with a removed subject', () => {
    expect(m.removeSubjectText('Maths')).toMatch(/"Maths".*marks.*deleted/);
  });
});
