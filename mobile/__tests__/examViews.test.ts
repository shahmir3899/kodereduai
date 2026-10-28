import { formatPercent, groupSubjectsByExam, resultStatus, summarizeResults, type ResultRow } from '../services/examViews';
import {
  buildAssessmentPayload, buildBulkPayload, canEditPrincipalRemark, changedStudents, emptyForm, formFromRow,
  formsEqual, monthOptions, ratedCount, toggleRating, TOTAL_RATINGS, type RosterRow,
} from '../services/assessments';

const row = (id: number, extra: Partial<ResultRow> = {}): ResultRow => ({
  student_id: id, student_name: `S${id}`, rank: id, total_obtained: 80, total_possible: 100, percentage: 80, is_pass: true,
  marks: [{ subject_name: 'Math', marks_obtained: 80 }], ...extra,
});

describe('resultStatus', () => {
  it('passes and fails by the server flag', () => {
    expect(resultStatus(row(1))).toBe('pass');
    expect(resultStatus(row(1, { is_pass: false }))).toBe('fail');
  });

  it('calls a student with a missing subject mark incomplete, not failed', () => {
    expect(resultStatus(row(1, { is_pass: false, marks: [{ subject_name: 'Math', marks_obtained: null }] }))).toBe('incomplete');
  });

  it('does not count an absent subject as missing', () => {
    expect(resultStatus(row(1, { marks: [{ subject_name: 'Math', marks_obtained: null, is_absent: true }] }))).toBe('pass');
  });
});

describe('summarizeResults', () => {
  it('has nothing for an empty list', () => {
    expect(summarizeResults([])).toBeNull();
  });

  it('counts each status, averages students with marks and finds the toppers', () => {
    const s = summarizeResults([
      row(1, { percentage: 90, total_obtained: 90 }),
      row(2, { is_pass: false, percentage: 30, total_obtained: 30 }),
      row(3, { marks: [{ subject_name: 'Math', marks_obtained: null }], total_obtained: 0, percentage: 0 }),
    ])!;
    expect(s).toMatchObject({ total: 3, pass: 1, fail: 1, incomplete: 1, toppers: ['S1'], topperTotal: 90, topperPercent: 90 });
    expect(s.average).toBe(60);
  });

  it('reports a tie for first place', () => {
    const s = summarizeResults([row(1, { rank: 1 }), row(2, { rank: 1 })])!;
    expect(s.toppers).toEqual(['S1', 'S2']);
  });

  it('formats percentages', () => {
    expect(formatPercent(83.333)).toBe('83.3%');
    expect(formatPercent('50')).toBe('50.0%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('groupSubjectsByExam', () => {
  it('groups by exam, in date order with undated subjects last', () => {
    const grouped = groupSubjectsByExam([
      { id: 1, exam: 10, subject_name: 'Math', exam_date: '2026-11-05' },
      { id: 2, exam: 10, subject_name: 'Urdu', exam_date: null },
      { id: 3, exam: 10, subject_name: 'Science', exam_date: '2026-11-02' },
      { id: 4, exam: 11, subject_name: 'Art', exam_date: '2026-11-09' },
    ]);
    expect(grouped[10].map((s) => s.id)).toEqual([3, 1, 2]);
    expect(grouped[11]).toHaveLength(1);
  });
});

describe('assessments', () => {
  const roster: RosterRow[] = [
    { student: 1, student_name: 'Ali', listening: 4, speaking: null, teacher_remark: 'good' },
    { student: 2, student_name: 'Bilal' },
  ];

  it('builds a form from a roster row, blank where nothing is rated', () => {
    const f = formFromRow(roster[0]);
    expect(f.listening).toBe(4);
    expect(f.speaking).toBeNull();
    expect(f.teacher_remark).toBe('good');
    expect(ratedCount(f)).toBe(1);
    expect(TOTAL_RATINGS).toBe(12);
  });

  it('sets a rating and clears it when tapped again', () => {
    const f = toggleRating(emptyForm(), 'writing', 3);
    expect(f.writing).toBe(3);
    expect(toggleRating(f, 'writing', 3).writing).toBeNull();
    expect(toggleRating(f, 'writing', 5).writing).toBe(5);
  });

  it('lists only the students whose form changed', () => {
    const edits = { 1: formFromRow(roster[0]), 2: toggleRating(formFromRow(roster[1]), 'reading', 5) };
    expect(changedStudents(roster, edits)).toEqual([2]);
    expect(formsEqual(edits[1], formFromRow(roster[0]))).toBe(true);
  });

  it('keeps a teacher out of the principal remark', () => {
    expect(canEditPrincipalRemark('TEACHER', false)).toBe(false);
    expect(canEditPrincipalRemark('PRINCIPAL', false)).toBe(true);
    expect(canEditPrincipalRemark('TEACHER', true)).toBe(true);
    const form = { ...emptyForm(), principal_remark: 'x', teacher_remark: 't' };
    expect(buildAssessmentPayload(1, form, false)).toMatchObject({ student: 1, teacher_remark: 't', principal_remark: '' });
    expect(buildAssessmentPayload(1, form, true).principal_remark).toBe('x');
  });

  it('sends only changed students in the bulk payload, with the section when known', () => {
    const edits = { 2: toggleRating(formFromRow(roster[1]), 'reading', 5) };
    const payload = buildBulkPayload({
      academicYearId: 7, month: 10, sessionClassId: 11, classObjId: 5, roster, edits, canEditPrincipal: false,
    });
    expect(payload).toMatchObject({ academic_year: 7, month: 10, session_class: 11, class_obj: 5 });
    expect(payload.assessments).toHaveLength(1);
    expect(payload.assessments[0]).toMatchObject({ student: 2, reading: 5, listening: null });
  });

  it('offers twelve months starting in January', () => {
    const months = monthOptions();
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ value: 1, label: 'January' });
  });
});
