import {
  MAX_EXAMS, adjacentEnrollment, attendanceNote, attendanceShares, examCell, examNote, examTotal, formatClassAvg,
  formatIssueDate, formatPct, normalizeExamSelection, shortExamName, sortEnrollments, sortExams, stars, toggleExam,
  type ReportExam,
} from '../services/reportCard';

describe('exams', () => {
  const exams = [
    { id: 3, name: 'Final', end_date: '2026-12-10' },
    { id: 1, name: 'Quiz', end_date: '2026-09-01' },
    { id: 2, name: 'Mid', start_date: '2026-10-05', end_date: null },
    { id: 4, name: 'Undated' },
  ];

  it('sorts oldest first by end, else start date, with ties by id', () => {
    expect(sortExams(exams).map((e) => e.id)).toEqual([4, 1, 2, 3]);
    expect(sortExams([{ id: 9, name: 'b', end_date: '2026-01-01' }, { id: 8, name: 'a', end_date: '2026-01-01' }]).map((e) => e.id)).toEqual([8, 9]);
  });

  it('defaults to the latest exam and drops ticks that no longer apply', () => {
    const sorted = sortExams(exams);
    expect(normalizeExamSelection([], sorted)).toEqual([3]);
    expect(normalizeExamSelection([99], sorted)).toEqual([3]);
    expect(normalizeExamSelection([1, 99], sorted)).toEqual([1]);
    expect(normalizeExamSelection([1, 2], sorted)).toEqual([1, 2]);
    expect(normalizeExamSelection([1], [])).toEqual([]);
  });

  it('ticks and unticks, never below one and never above four', () => {
    expect(toggleExam([1], 2)).toEqual([1, 2]);
    expect(toggleExam([1, 2], 2)).toEqual([1]);
    expect(toggleExam([1], 1)).toEqual([1]);
    const full = [1, 2, 3, 4];
    expect(full).toHaveLength(MAX_EXAMS);
    expect(toggleExam(full, 5)).toEqual(full);
  });

  it('shortens exam names for narrow headers', () => {
    expect(shortExamName('1st Term Exam 2026-27 - Playgroup')).toBe('1st Term Exam');
    expect(shortExamName('Midterm 2026-27')).toBe('Midterm');
    expect(shortExamName('')).toBe('');
  });
});

describe('students', () => {
  const list = [
    { id: 1, student: 11, student_name: 'a', roll_number: '10' },
    { id: 2, student: 12, student_name: 'b', roll_number: '2' },
    { id: 3, student: 13, student_name: 'c', roll_number: '3' },
  ];

  it('sorts rolls naturally', () => {
    expect(sortEnrollments(list).map((e) => e.id)).toEqual([2, 3, 1]);
  });

  it('steps to the neighbour and stops at either end', () => {
    const sorted = sortEnrollments(list);
    expect(adjacentEnrollment(sorted, 3, 1)?.id).toBe(1);
    expect(adjacentEnrollment(sorted, 3, -1)?.id).toBe(2);
    expect(adjacentEnrollment(sorted, 2, -1)).toBeNull();
    expect(adjacentEnrollment(sorted, 1, 1)).toBeNull();
    expect(adjacentEnrollment(sorted, null, 1)).toBeNull();
  });
});

describe('attendance', () => {
  const a = { working_days: 20, present: 15, absent: 3, leave: 2, not_marked: 0 };

  it('splits the bar by share of working days', () => {
    expect(attendanceShares(a)).toEqual({ present: 75, absent: 15, leave: 10 });
    expect(attendanceShares({ ...a, working_days: 0 })).toEqual({ present: 0, absent: 0, leave: 0 });
  });

  it('explains missing attendance, harder when the data looks suspect', () => {
    expect(attendanceNote(a)).toBeNull();
    expect(attendanceNote({ ...a, not_marked: 1 })).toBe('Percentage hidden: 1 working day has no attendance recorded.');
    expect(attendanceNote({ ...a, not_marked: 3 })).toContain('3 working days have');
    expect(attendanceNote({ ...a, not_marked: 5, suspect: true })).toContain('Check the attendance register');
  });
});

describe('marks cells', () => {
  const exam: ReportExam = {
    exam_id: 1, exam_name: 'e', marks: {
      10: { marks_obtained: 17, total_marks: 20 },
      11: { marks_obtained: null, total_marks: 30, is_absent: true },
      12: { marks_obtained: null, total_marks: 10 },
    },
  };

  it('shows marks, absent or a dash', () => {
    expect(examCell(exam, 10)).toBe('17/20');
    expect(examCell(exam, 11)).toBe('Abs');
    expect(examCell(exam, 12)).toBe('—/10');
    expect(examCell(exam, 99)).toBe('—');
  });

  it('totals only the subjects the exam has, leaving absent and blank marks out of the score', () => {
    expect(examTotal(exam, [10, 11, 12, 99])).toBe('17/60');
    expect(examTotal(exam, [99])).toBe('—');
  });
});

describe('formatting', () => {
  it('formats percentages and class averages', () => {
    expect(formatPct(83.333)).toBe('83.3%');
    expect(formatPct(null)).toBe('—');
    expect(formatClassAvg(72, 'percent')).toBe('72%');
    expect(formatClassAvg(72, 'marks')).toBe('72');
    expect(formatClassAvg(null, 'marks')).toBe('—');
  });

  it('draws stars and clamps the rating', () => {
    expect(stars(3)).toBe('★★★☆☆');
    expect(stars(null)).toBe('☆☆☆☆☆');
    expect(stars(9)).toBe('★★★★★');
  });

  it('formats an issue date and leaves bad input alone', () => {
    expect(formatIssueDate('2026-10-28')).toBe('28 Oct 2026');
    expect(formatIssueDate('not a date')).toBe('not a date');
  });

  it('says which exam decided the result', () => {
    expect(examNote({})).toBeNull();
    expect(examNote({ earlier_exam_names: ['Quiz'], main_exam: { name: 'Final' } }))
      .toBe('Result is from Final. Earlier exams shown for reference: Quiz');
    expect(examNote({ earlier_exam_names: ['Quiz'], weighted: true, main_exam: { name: 'Final' } }))
      .toBe('Weighted result across: Quiz, Final');
  });
});
