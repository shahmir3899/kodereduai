import {
  buildMarkRows, buildMarksPayload, describeRejected, examsForSection, inferSubjectId, isDirty, resultOf,
  rosterParams, setAbsent, setMarks, setRemarks, sortByRoll, summarize, validateMark, validateRows,
  type ExamLite, type ExamSubjectLite, type MarkRow,
} from '../services/marksEntry';

const roster = [
  { id: 1, name: 'Ali', roll_number: '10' },
  { id: 2, name: 'Bilal', roll_number: '2' },
  { id: 3, name: 'Cara', roll_number: null },
];

describe('sortByRoll', () => {
  it('sorts numerically, then text, with blank rolls last', () => {
    const rows = [{ roll: '' }, { roll: '10' }, { roll: 'A1' }, { roll: '2' }];
    expect(sortByRoll(rows).map((r) => r.roll)).toEqual(['2', '10', 'A1', '']);
  });
});

describe('buildMarkRows', () => {
  it('builds from the roster and fills saved marks in', () => {
    const rows = buildMarkRows(roster, [{ student: 1, marks_obtained: 17.5, is_absent: false, remarks: 'good' }]);
    expect(rows.map((r) => r.studentId)).toEqual([2, 1, 3]);
    const ali = rows.find((r) => r.studentId === 1)!;
    expect(ali).toMatchObject({ marks: '17.5', isAbsent: false, remarks: 'good' });
    expect(rows.find((r) => r.studentId === 2)).toMatchObject({ marks: '', isAbsent: false });
  });

  it('drops saved marks of students who are no longer on the roster', () => {
    const rows = buildMarkRows(roster, [{ student: 99, marks_obtained: 5, is_absent: false }]);
    expect(rows.map((r) => r.studentId)).not.toContain(99);
  });

  it('keeps an absent flag and treats a null mark as blank', () => {
    const rows = buildMarkRows(roster, [{ student: 2, marks_obtained: null, is_absent: true }]);
    expect(rows.find((r) => r.studentId === 2)).toMatchObject({ marks: '', isAbsent: true });
  });

  it('falls back to the saved marks when there is no roster', () => {
    const rows = buildMarkRows([], [{ student: 7, student_name: 'Zed', student_roll_number: '1', marks_obtained: 3, is_absent: false }]);
    expect(rows).toEqual([{ studentId: 7, name: 'Zed', roll: '1', marks: '3', isAbsent: false, remarks: '' }]);
  });
});

describe('editing', () => {
  const rows = buildMarkRows(roster, []);

  it('marking absent clears the mark', () => {
    const typed = setMarks(rows, 1, '12');
    const absent = setAbsent(typed, 1, true);
    expect(absent.find((r) => r.studentId === 1)).toMatchObject({ marks: '', isAbsent: true });
    expect(setAbsent(absent, 1, false).find((r) => r.studentId === 1)?.isAbsent).toBe(false);
  });

  it('is dirty on any change and clean again when reverted', () => {
    expect(isDirty(rows, rows)).toBe(false);
    expect(isDirty(setMarks(rows, 1, '5'), rows)).toBe(true);
    expect(isDirty(setRemarks(rows, 1, 'x'), rows)).toBe(true);
    expect(isDirty(setMarks(setMarks(rows, 1, '5'), 1, ''), rows)).toBe(false);
  });
});

describe('validation', () => {
  it('accepts blank, whole and two-decimal marks up to the total', () => {
    for (const ok of ['', '0', '17', '17.5', '17.25', '20']) expect(validateMark(ok, 20)).toBeNull();
  });

  it('rejects text, negatives, three decimals and marks over the total', () => {
    expect(validateMark('abc', 20)).toBe('Enter a number');
    expect(validateMark('-1', 20)).toBe('Enter a number');
    expect(validateMark('1.234', 20)).toBe('Enter a number');
    expect(validateMark('20.5', 20)).toBe('Max 20');
  });

  it('ignores absent students when validating all rows', () => {
    const rows: MarkRow[] = [
      { studentId: 1, name: 'a', roll: '1', marks: '99', isAbsent: true, remarks: '' },
      { studentId: 2, name: 'b', roll: '2', marks: '99', isAbsent: false, remarks: '' },
    ];
    expect(validateRows(rows, 20)).toEqual({ 2: 'Max 20' });
  });
});

describe('results and summary', () => {
  const row = (marks: string, isAbsent = false): MarkRow => ({ studentId: 1, name: 'a', roll: '1', marks, isAbsent, remarks: '' });

  it('passes at the passing mark and fails below it', () => {
    expect(resultOf(row('8'), 8)).toBe('pass');
    expect(resultOf(row('7.9'), 8)).toBe('fail');
    expect(resultOf(row(''), 8)).toBeNull();
    expect(resultOf(row('5', true), 8)).toBeNull();
  });

  it('counts entered, absent, failing and missing', () => {
    const rows = [row('10'), row('3'), row('', true), row('')].map((r, i) => ({ ...r, studentId: i }));
    expect(summarize(rows, 8)).toEqual({ entered: 2, absent: 1, failing: 1, missing: 1 });
  });
});

describe('buildMarksPayload', () => {
  it('sends every row, blanks and absentees as null', () => {
    const rows: MarkRow[] = [
      { studentId: 1, name: 'a', roll: '1', marks: '17.5', isAbsent: false, remarks: 'ok' },
      { studentId: 2, name: 'b', roll: '2', marks: '', isAbsent: false, remarks: '' },
      { studentId: 3, name: 'c', roll: '3', marks: '9', isAbsent: true, remarks: '' },
    ];
    expect(buildMarksPayload(44, rows)).toEqual({
      exam_subject_id: 44,
      marks: [
        { student_id: 1, marks_obtained: 17.5, is_absent: false, remarks: 'ok' },
        { student_id: 2, marks_obtained: null, is_absent: false, remarks: '' },
        { student_id: 3, marks_obtained: null, is_absent: true, remarks: '' },
      ],
    });
  });

  it('names the students the server rejected', () => {
    const rows = buildMarkRows(roster, []);
    expect(describeRejected([{ student_id: 1, error: 'Marks must be between 0 and 20.' }, { student_id: 77, error: 'x' }], rows))
      .toEqual(['Ali: Marks must be between 0 and 20.', 'Student: x']);
    expect(describeRejected(undefined, rows)).toEqual([]);
  });
});

describe('exam helpers', () => {
  const subjects: ExamSubjectLite[] = [
    { id: 1, subject: 10, subject_name: 'Math', total_marks: 50, passing_marks: 20 },
    { id: 2, subject: 11, subject_name: 'Science', total_marks: 50, passing_marks: 20 },
  ];

  it('preselects a lone subject, or the one named in the exam title', () => {
    expect(inferSubjectId('Anything', [subjects[0]])).toBe(1);
    expect(inferSubjectId('Class 5 Science Test', subjects)).toBe(2);
    expect(inferSubjectId('Midterm', subjects)).toBeNull();
    expect(inferSubjectId(undefined, subjects)).toBeNull();
  });

  it('scopes the roster to the exam section, else the whole class', () => {
    const sec: ExamLite = { id: 1, name: 'e', class_obj: 5, session_class: 11, academic_year: 7 };
    expect(rosterParams(sec)).toMatchObject({ session_class_id: 11, academic_year: 7, is_active: true });
    expect(rosterParams(sec)).not.toHaveProperty('class_id');
    expect(rosterParams({ ...sec, session_class: null })).toMatchObject({ class_id: 5 });
  });

  it('hides exams of other sections but keeps class-wide ones', () => {
    const exams: ExamLite[] = [
      { id: 1, name: 'A only', class_obj: 5, session_class: 11, academic_year: 7 },
      { id: 2, name: 'B only', class_obj: 5, session_class: 12, academic_year: 7 },
      { id: 3, name: 'All', class_obj: 5, session_class: null, academic_year: 7 },
    ];
    expect(examsForSection(exams, 11, true).map((e) => e.id)).toEqual([1, 3]);
    expect(examsForSection(exams, 5, false)).toHaveLength(3);
  });
});
