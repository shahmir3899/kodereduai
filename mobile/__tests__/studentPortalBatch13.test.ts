import {
  attendanceCells, attendanceTile, examTotals, pctTone, subjectResult, type PortalResultExam,
} from '../services/studentPortal';

type Sub = PortalResultExam['subjects'][number];
const sub = (over: Partial<Sub>): Sub => ({ subject: 'Maths', marks_obtained: 50, total_marks: 100, is_absent: false, ...over });

describe('subjectResult', () => {
  it('uses the exam passing marks when the server sends them', () => {
    expect(subjectResult(sub({ marks_obtained: 45, passing_marks: 50 }))).toBe('fail');
    expect(subjectResult(sub({ marks_obtained: 50, passing_marks: 50 }))).toBe('pass');
  });
  it('falls back to 40 percent without passing marks', () => {
    expect(subjectResult(sub({ marks_obtained: 39 }))).toBe('fail');
    expect(subjectResult(sub({ marks_obtained: 40 }))).toBe('pass');
  });
  it('reads absent and unmarked rows without a pass or fail', () => {
    expect(subjectResult(sub({ is_absent: true, marks_obtained: null }))).toBe('absent');
    expect(subjectResult(sub({ marks_obtained: null }))).toBe('none');
  });
});

describe('examTotals', () => {
  it('leaves absent subjects out of the total', () => {
    const exam = { exam_id: 1, exam_name: 'T', subjects: [sub({ marks_obtained: 80 }), sub({ is_absent: true, marks_obtained: null }), sub({ marks_obtained: 60, total_marks: 50 })] } as PortalResultExam;
    expect(examTotals(exam)).toEqual({ got: 140, max: 150, pct: 93 });
  });
  it('has no percentage when nothing was sat', () => {
    expect(examTotals({ exam_id: 1, exam_name: 'T', subjects: [] }).pct).toBeNull();
  });
});

describe('pctTone', () => {
  it('bands at 80, 60 and 40', () => {
    expect([90, 80, 79, 60, 59, 40, 39].map(pctTone)).toEqual(['success', 'success', 'info', 'info', 'warning', 'warning', 'error']);
    expect(pctTone(null)).toBe('neutral');
  });
});

describe('attendanceTile', () => {
  it('reads N/A on an off day or with no days yet', () => {
    expect(attendanceTile({ total_days: 20, rate: 90 }, true)).toBe('N/A');
    expect(attendanceTile({ total_days: 0, rate: 0 }, false)).toBe('N/A');
    expect(attendanceTile({ total_days: 20, rate: 90 }, false)).toBe('90%');
  });
});

describe('attendanceCells off days', () => {
  it('uses the school calendar when it answers and Sunday otherwise', () => {
    const cells = attendanceCells(2026, 10, [], { '2026-10-14': { is_off_day: true }, '2026-10-04': { is_off_day: false } });
    const byDay = (d: number) => cells.find((c) => c.day === d)!;
    expect(byDay(14).off).toBe(true);   // calendar says closed (a Wednesday)
    expect(byDay(4).off).toBe(false);   // calendar says open even though it is a Sunday
    expect(byDay(11).off).toBe(true);   // no answer: Sunday
    expect(byDay(12).off).toBe(false);  // no answer: Monday
  });
});
