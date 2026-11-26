import {
  buildTestName, bulkTestError, bulkTestPayload, previewSummary, syncRows, uniqueSubjects, validateDetails, validateSchedule,
} from '../services/bulkTests';
import {
  draftsFromSaved, enteredCount, plainQuestion, responseRows, savedMessage, validateDrafts,
} from '../services/studentResponses';

describe('bulk tests', () => {
  it('names a test like the web and the server', () => {
    expect(buildTestName('Maths', 'Term 1', 'Academic Year 2026-27')).toBe('Test - Maths - Term 1 2026-27');
    expect(buildTestName('Term 1 Maths', 'Term 1', null)).toBe('Test - Term 1 Maths');
    expect(buildTestName('English')).toBe('Test - English');
  });

  it('lists each subject once, A to Z', () => {
    const rows = [{ subject: 2, subject_name: 'Science' }, { subject: 1, subject_name: 'English' }, { subject: 2, subject_name: 'Science' }];
    expect(uniqueSubjects(rows).map((s) => s.subject)).toEqual([1, 2]);
  });

  it('keeps typed values and a hand-written name when subjects change', () => {
    const subjects = [{ subject: 1, subject_name: 'English' }, { subject: 2, subject_name: 'Maths' }];
    const first = syncRows([], [1], subjects, null, '2026-27');
    expect(first[0]).toMatchObject({ name: 'Test - English 2026-27', totalMarks: '100', date: '' });
    const edited = [{ ...first[0], name: 'Spelling test', manualName: true, date: '2026-12-01' }];
    const next = syncRows(edited, [1, 2], subjects, 'Term 2', '2026-27');
    expect(next[0]).toMatchObject({ name: 'Spelling test', date: '2026-12-01' });
    expect(next[1].name).toBe('Test - Maths - Term 2 2026-27');
  });

  it('checks each step', () => {
    const d = { yearId: 1, termId: null, examTypeId: 2, classObj: 3, subjectIds: [1] };
    expect(validateDetails({ ...d, examTypeId: null })).toBe('Choose the test type.');
    expect(validateDetails({ ...d, subjectIds: [] })).toBe('Choose at least one subject.');
    expect(validateDetails(d)).toBeNull();
    const row = { subjectId: 1, subjectName: 'Maths', name: 'x', manualName: false, date: '2026-12-01', totalMarks: '50', start: '', end: '' };
    expect(validateSchedule([{ ...row, date: '' }])).toBe('Maths: choose the date.');
    expect(validateSchedule([{ ...row, totalMarks: '0' }])).toMatch(/more than 0/);
    expect(validateSchedule([{ ...row, start: '9am' }])).toMatch(/HH:MM/);
    expect(validateSchedule([{ ...row, start: '10:00', end: '09:00' }])).toMatch(/on or after/);
    expect(validateSchedule([row])).toBeNull();
  });

  it('sends the web body', () => {
    const d = { yearId: 1, termId: null, examTypeId: 2, classObj: 3, subjectIds: [1] };
    const row = { subjectId: 1, subjectName: 'Maths', name: ' Test - Maths ', manualName: false, date: '2026-12-01', totalMarks: '50', start: '09:00', end: '' };
    expect(bulkTestPayload(d, [row])).toEqual({
      academic_year: 1, term: null, exam_type: 2, class_obj: 3,
      tests: [{ subject_id: 1, name: 'Test - Maths', exam_date: '2026-12-01', total_marks: 50, start_time: '09:00', end_time: null }],
    });
  });

  it('summarises the preview and reads nested server errors', () => {
    expect(previewSummary({ can_apply: false, counts: { requested: 3, create: 1, conflict: 1, forbidden: 0, invalid: 1 }, tests: [] }))
      .toBe('1 to create  ·  1 already exist  ·  1 cannot be made');
    expect(bulkTestError({ response: { data: { tests: [{ exam_date: ['Enter a valid date.'] }] } } })).toBe('Enter a valid date.');
    expect(bulkTestError({ response: { data: { detail: 'Preview contains conflicts.' } } })).toBe('Preview contains conflicts.');
  });
});

describe('student responses', () => {
  const qs = [{ id: 10, question: 1, marks: 5 }, { id: 11, question: 2, marks_override: 2, marks: 4 }];

  it('loads saved answers and strips question markup', () => {
    expect(draftsFromSaved([{ question: 1, response_text: 'Photosynthesis', marks_awarded: '4.00', is_correct: true }]))
      .toEqual({ 1: { text: 'Photosynthesis', marks: '4', correct: true } });
    expect(plainQuestion('<div dir="ltr"><p>Which&nbsp;part?</p></div>')).toBe('Which part?');
  });

  it('checks marks against the question and sends only questions with something entered', () => {
    expect(validateDrafts(qs, { 2: { text: '', marks: '3', correct: null } })).toBe('Question 2: at most 2 marks.');
    expect(validateDrafts(qs, { 1: { text: '', marks: '-1', correct: null } })).toMatch(/0 or more/);
    expect(responseRows(qs, { 1: { text: 'Leaf', marks: '', correct: true }, 2: { text: ' ', marks: '', correct: null } }))
      .toEqual([{ question: 1, response_text: 'Leaf', marks_awarded: null, is_correct: true }]);
  });

  it('reports what was saved and how many students have answers', () => {
    expect(savedMessage({ created_count: 2, updated_count: 1 })).toBe('Saved: 2 added, 1 updated.');
    expect(enteredCount([{ student: 1 }, { student: 1 }, { student: 3 }])).toBe(2);
  });
});
