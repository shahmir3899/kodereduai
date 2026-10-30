import {
  addDays, autoFill, buildPairs, buildWizardPayload, conflictText, emptyDetails, examDays, isSunday, scheduledCount,
  sectionLabels, subjectsBySection, suggestName, validateClasses, validateDetails, validateSheet, withDefaultSubjects,
} from '../services/examWizard';

const rows = [
  { session_class: 30, subject: 2, subject_name: 'Maths' }, { session_class: 30, subject: 1, subject_name: 'English' },
  { session_class: 31, subject: 2, subject_name: 'Maths' }, { session_class: null, subject: 9, subject_name: 'Ignored' },
];
const map = subjectsBySection(rows);
const labels = { 30: '5-A', 31: '5-B' };

describe('details', () => {
  const ok = { ...emptyDetails(), name: 'Midterm', examType: 2, start: '2026-12-01', end: '2026-12-10' };
  it('suggests a name from type, term and year', () => {
    expect(suggestName('Midterm', 'Term 1', 'Academic Year 2026-27')).toBe('Midterm - Term 1 2026-27');
    expect(suggestName('Term 1 Exam', 'Term 1', undefined)).toBe('Term 1 Exam');
    expect(suggestName(undefined, 'x', 'y')).toBe('');
  });
  it('checks name, type, dates and marks', () => {
    expect(validateDetails({ ...ok, name: ' ' })).toMatch(/name/);
    expect(validateDetails({ ...ok, examType: null })).toMatch(/type/);
    expect(validateDetails({ ...ok, start: '' })).toMatch(/first and last/);
    expect(validateDetails({ ...ok, end: '2026-11-30' })).toMatch(/before/);
    expect(validateDetails({ ...ok, totalMarks: '0' })).toMatch(/Total/);
    expect(validateDetails({ ...ok, passingMarks: '101' })).toMatch(/Passing/);
    expect(validateDetails({ ...ok, failThreshold: '0' })).toMatch(/1 or more/);
    expect(validateDetails(ok)).toBeNull();
  });
});

describe('classes and subjects', () => {
  it('lists subjects per section by name and ignores whole-class rows', () => {
    expect(map[30].map((s) => s.name)).toEqual(['English', 'Maths']);
    expect(map[31]).toHaveLength(1);
    expect(Object.keys(map)).toEqual(['30', '31']);
  });
  it('gives a newly chosen section every subject, and keeps earlier choices', () => {
    expect(withDefaultSubjects({}, [30, 31], map)).toEqual({ 30: [1, 2], 31: [2] });
    expect(withDefaultSubjects({ 30: [2] }, [30, 31], map)).toEqual({ 30: [2], 31: [2] });
  });
  it('needs a class and a subject', () => {
    expect(validateClasses([], {})).toMatch(/class/);
    expect(validateClasses([30], { 30: [] })).toMatch(/subject/);
    expect(validateClasses([30], { 30: [1] })).toBeNull();
  });
  it('builds subject-first pairs for the chosen subjects only', () => {
    const pairs = buildPairs([30, 31], { 30: [1, 2], 31: [2] }, map, labels);
    expect(pairs.map((p) => p.key)).toEqual(['30_1', '30_2', '31_2']);
    expect(buildPairs([30], { 30: [2] }, map, labels).map((p) => p.subjectName)).toEqual(['Maths']);
  });
});

describe('dates', () => {
  it('knows Sundays and skips them', () => {
    expect(isSunday('2026-11-01')).toBe(true);
    expect(isSunday('2026-11-02')).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(examDays('2026-10-31', 3)).toEqual(['2026-10-31', '2026-11-02', '2026-11-03']);
  });
  it('gives each subject name one day for every class and extends a short range', () => {
    const pairs = buildPairs([30, 31], { 30: [1, 2], 31: [2] }, map, labels);
    const r = autoFill(pairs, '2026-10-31', '2026-10-31');
    expect(r.sheet['30_1'].date).toBe('2026-10-31');
    expect(r.sheet['30_2'].date).toBe('2026-11-02');
    expect(r.sheet['31_2'].date).toBe('2026-11-02');
    expect(r.extendedTo).toBe('2026-11-02');
    expect(r.end).toBe('2026-11-02');
    expect(autoFill(pairs, '2026-10-31', '2026-11-10')).toMatchObject({ extendedTo: null, end: '2026-11-10' });
  });
  it('checks the sheet against the range and the times', () => {
    expect(validateSheet({ a: { date: '2026-12-11' } }, '2026-12-01', '2026-12-10')).toMatch(/outside/);
    expect(validateSheet({ a: { date: '2026-12-02', start: '9am' } }, '2026-12-01', '2026-12-10')).toMatch(/09:00/);
    expect(validateSheet({ a: { date: '2026-12-02', start: '11:00', end: '10:00' } }, '2026-12-01', '2026-12-10')).toMatch(/ends before/);
    expect(validateSheet({ a: { date: '' } }, '2026-12-01', '2026-12-10')).toBeNull();
    expect(validateSheet({ a: { date: '2026-12-02', start: '09:00', end: '11:30' } }, '2026-12-01', '2026-12-10')).toBeNull();
    expect(scheduledCount({ a: { date: '2026-12-02' }, b: { date: '' } })).toBe(1);
  });
});

describe('payload and conflicts', () => {
  it('sends sections, per-class subjects and only the dated rows', () => {
    const d = { ...emptyDetails(), name: ' Midterm ', examType: 2, term: 3, start: '2026-12-01', end: '2026-12-10', totalMarks: '50', passingMarks: '20' };
    const p = buildWizardPayload(d, 7, [30, 31], { 30: [1, 2], 31: [2] }, { '30_1': { date: '2026-12-02', start: '09:00', end: '11:00' }, '30_2': { date: '' }, '31_2': { date: '2026-12-03' } });
    expect(p).toMatchObject({
      academic_year: 7, term: 3, exam_type: 2, name: 'Midterm', session_class_ids: [30, 31],
      class_subjects: [{ session_class_id: 30, subject_ids: [1, 2] }, { session_class_id: 31, subject_ids: [2] }],
      default_total_marks: 50, default_passing_marks: 20, fail_threshold_subjects: 3,
    });
    expect(p.date_sheet).toEqual([
      { session_class_id: 30, subject_id: 1, exam_date: '2026-12-02', start_time: '09:00', end_time: '11:00' },
      { session_class_id: 31, subject_id: 2, exam_date: '2026-12-03', start_time: null, end_time: null },
    ]);
    expect(p).not.toHaveProperty('class_ids');
  });
  it('explains a 409 conflict by class', () => {
    expect(conflictText({ conflicts: [{ class_name: '5-A', existing_exam: 'Midterm 2026' }] })).toMatch(/5-A \(already in "Midterm 2026"\)/);
    expect(conflictText({ detail: 'x' })).toBeNull();
    expect(conflictText(undefined)).toBeNull();
  });
  it('labels only sections', () => {
    expect(sectionLabels([{ id: 30, label: '5-A', classObj: 5, isSession: true }, { id: 5, label: '5', classObj: null, isSession: false }])).toEqual({ 30: '5-A' });
  });
});
