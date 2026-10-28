import {
  buildClassOptions, buildRows, buildSavePayload, classParams, countStatuses, isDirty,
  isFutureDate, markAll, setStatus, todayString, type ClassOption,
} from '../services/attendanceEntry';
import { listOf, pickAcademicYear } from '../services/academicYear';

const enrolled = [
  { student: 3, student_name: 'Cara', roll_number: '10' },
  { student: 1, student_name: 'Ali', roll_number: '2' },
  { student: 2, student_name: 'Bilal', roll_number: null },
];

describe('buildRows', () => {
  it('sorts by numeric roll number, not text', () => {
    expect(buildRows(enrolled, []).map((r) => r.name)).toEqual(['Bilal', 'Ali', 'Cara']);
  });

  it('starts everyone NOT_SET when nothing is saved', () => {
    expect(buildRows(enrolled, []).every((r) => r.status === 'NOT_SET')).toBe(true);
  });

  it('applies saved statuses, reading either student or student_id', () => {
    const rows = buildRows(enrolled, [
      { student: 1, status: 'PRESENT' },
      { student_id: 3, status: 'ABSENT' },
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.studentId, r.status]));
    expect(byId).toEqual({ 1: 'PRESENT', 2: 'NOT_SET', 3: 'ABSENT' });
  });

  it('ignores a saved status it does not know', () => {
    expect(buildRows(enrolled, [{ student: 1, status: 'HOLIDAY' }])[1].status).toBe('NOT_SET');
  });
});

describe('editing rows', () => {
  const rows = buildRows(enrolled, []);

  it('sets one student without touching the others', () => {
    const next = setStatus(rows, 1, 'LEAVE');
    expect(next.find((r) => r.studentId === 1)?.status).toBe('LEAVE');
    expect(next.filter((r) => r.status === 'NOT_SET')).toHaveLength(2);
  });

  it('marks everyone', () => {
    expect(markAll(rows, 'PRESENT').every((r) => r.status === 'PRESENT')).toBe(true);
  });

  it('counts each status', () => {
    const marked = setStatus(setStatus(rows, 1, 'PRESENT'), 2, 'ABSENT');
    expect(countStatuses(marked)).toEqual({ present: 1, absent: 1, leave: 0, notSet: 1 });
  });

  it('is dirty only when a status differs from what was loaded', () => {
    expect(isDirty(rows, rows)).toBe(false);
    expect(isDirty(setStatus(rows, 1, 'PRESENT'), rows)).toBe(true);
    expect(isDirty(setStatus(setStatus(rows, 1, 'PRESENT'), 1, 'NOT_SET'), rows)).toBe(false);
  });
});

describe('buildSavePayload', () => {
  const rows = setStatus(setStatus(buildRows(enrolled, []), 1, 'PRESENT'), 3, 'ABSENT');

  it('sends only marked students, with the class params and year', () => {
    const payload = buildSavePayload({ session_class_id: 9, class_id: 4 }, 7, '2026-10-27', rows);
    expect(payload).toEqual({
      session_class_id: 9,
      class_id: 4,
      academic_year: 7,
      date: '2026-10-27',
      entries: [
        { student_id: 1, status: 'PRESENT' },
        { student_id: 3, status: 'ABSENT' },
      ],
    });
  });

  it('returns null when nothing is marked, since the API rejects an empty list', () => {
    expect(buildSavePayload({}, 7, '2026-10-27', buildRows(enrolled, []))).toBeNull();
  });
});

describe('class options', () => {
  const sessionClasses = [
    { id: 11, class_obj: 5, display_name: 'Class 6', section: 'B', grade_level: 6 },
    { id: 12, class_obj: 4, display_name: 'Class 5', section: '', grade_level: 5 },
    { id: 13, class_obj: 3, display_name: 'Class 4', is_active: false, grade_level: 4 },
    { id: 14, class_obj: null, display_name: 'Orphan', grade_level: 1 },
  ];
  const master = [{ id: 4, name: 'Class 5', grade_level: 5 }, { id: 5, name: 'Class 6', section: 'B', grade_level: 6 }];

  it('prefers active, linked session classes, sorted by grade', () => {
    const { options, useSession } = buildClassOptions(sessionClasses, master);
    expect(useSession).toBe(true);
    expect(options.map((o) => o.label)).toEqual(['Class 5', 'Class 6 - B']);
  });

  it('falls back to master classes when the year has no session classes', () => {
    const { options, useSession } = buildClassOptions([], master);
    expect(useSession).toBe(false);
    expect(options.map((o) => o.label)).toEqual(['Class 5', 'Class 6 - B']);
  });

  it('sends session_class_id, year and the master id for a session class', () => {
    const opt: ClassOption = { id: 11, label: 'x', classObj: 5, isSession: true };
    expect(classParams(opt, 7)).toEqual({ session_class_id: 11, academic_year: 7, class_id: 5 });
  });

  it('sends only class_id for a master class', () => {
    const opt: ClassOption = { id: 4, label: 'x', classObj: null, isSession: false };
    expect(classParams(opt, 7)).toEqual({ class_id: 4 });
  });
});

describe('dates', () => {
  it('blocks only days after today', () => {
    expect(isFutureDate('2026-10-28', '2026-10-27')).toBe(true);
    expect(isFutureDate('2026-10-27', '2026-10-27')).toBe(false);
    expect(isFutureDate('2026-10-01', '2026-10-27')).toBe(false);
  });

  it('formats today as a local yyyy-MM-dd', () => {
    expect(todayString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('academic year', () => {
  it('picks the current year, else the first', () => {
    expect(pickAcademicYear([{ id: 1, name: 'a' }, { id: 2, name: 'b', is_current: true }])?.id).toBe(2);
    expect(pickAcademicYear([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])?.id).toBe(1);
    expect(pickAcademicYear([])).toBeNull();
  });

  it('reads a bare array or a paginated list', () => {
    expect(listOf([1, 2])).toEqual([1, 2]);
    expect(listOf({ results: [3] })).toEqual([3]);
    expect(listOf(undefined)).toEqual([]);
  });
});
