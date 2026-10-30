import type { TimetableEntry } from '../services/teacher';
import {
  assignmentLabel, attendanceClassId, buildTeacherAttention, countOf, examsAwaitingMarks, findPeriod,
  isPending, matchAssignment, minutesLabel, sectionParams, studentsAtRiskCount, upcomingExams,
  type Assignment, type SectionProgress,
} from '../services/teacherDashboard';

const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m);
const entry = (id: number, start: string | null, end: string | null, extra: Partial<TimetableEntry> = {}): TimetableEntry =>
  ({ id, day: 'WED', slot_start_time: start, slot_end_time: end, ...extra });

describe('findPeriod', () => {
  const day = [entry(1, '08:00:00', '08:40:00'), entry(2, '08:40:00', '09:20:00'), entry(3, '10:00:00', '10:40:00')];

  it('finds the period in progress and the minutes left', () => {
    expect(findPeriod(day, at(8, 10))).toEqual({ index: 0, state: 'now', minutes: 30 });
    expect(findPeriod(day, at(8, 40))).toEqual({ index: 1, state: 'now', minutes: 40 });
  });

  it('points at the next period between classes', () => {
    expect(findPeriod(day, at(9, 30))).toEqual({ index: 2, state: 'next', minutes: 30 });
  });

  it('points at the first period before school starts', () => {
    expect(findPeriod(day, at(7, 0))).toEqual({ index: 0, state: 'next', minutes: 60 });
  });

  it('is over after the last period', () => {
    expect(findPeriod(day, at(15, 0))).toEqual({ index: -1, state: null, minutes: 0 });
  });

  it('skips slots without a time instead of treating them as midnight', () => {
    expect(findPeriod([entry(1, null, null), entry(2, '09:00:00', '09:40:00')], at(8, 0))).toEqual({ index: 1, state: 'next', minutes: 60 });
  });
});

describe('assignments', () => {
  const sectioned: Assignment = { id: 1, class_obj: 5, session_class: 11, class_name: 'Class 5', class_section: 'A' };
  const legacy: Assignment = { id: 2, class_obj: 6, session_class: null, class_name: 'Class 6' };

  it('matches a section entry only to the same section', () => {
    expect(matchAssignment({ ...entry(1, null, null), session_class: 11, class_obj: 5 }, [sectioned, legacy])).toBe(sectioned);
    expect(matchAssignment({ ...entry(1, null, null), session_class: 12, class_obj: 5 }, [sectioned, legacy])).toBeNull();
  });

  it('matches a shared entry on the master class', () => {
    expect(matchAssignment({ ...entry(1, null, null), session_class: null, class_obj: 6 }, [sectioned, legacy])).toBe(legacy);
  });

  it('scopes lookups to one section, and to the master class only for legacy assignments', () => {
    expect(sectionParams(sectioned, 7)).toEqual({ session_class_id: 11, academic_year: 7 });
    expect(sectionParams(legacy, null)).toEqual({ class_id: 6 });
  });

  it('labels with the section and picks the right id for the attendance screen', () => {
    expect(assignmentLabel(sectioned)).toBe('Class 5 - A');
    expect(assignmentLabel(legacy)).toBe('Class 6');
    expect(attendanceClassId(sectioned)).toBe(11);
    expect(attendanceClassId(legacy)).toBe(6);
  });
});

describe('section progress', () => {
  const row = (total: number | null, marked: number | null, failed = false): SectionProgress =>
    ({ assignment: { id: 1, class_obj: 1 }, total, marked, failed });

  it('is pending only with students and fewer records than students', () => {
    expect(isPending(row(30, 12))).toBe(true);
    expect(isPending(row(30, 30))).toBe(false);
    expect(isPending(row(0, 0))).toBe(false);
  });

  it('never calls a failed lookup pending', () => {
    expect(isPending(row(null, null, true))).toBe(false);
  });
});

describe('counts', () => {
  it('reads a paginated count, an array, or nothing', () => {
    expect(countOf({ count: 42, results: [] })).toBe(42);
    expect(countOf([1, 2, 3])).toBe(3);
    expect(countOf({ results: [1, 2] })).toBe(2);
    expect(countOf(null)).toBeNull();
  });

  it('adds attendance and academic risk', () => {
    expect(studentsAtRiskCount({ attendance: { at_risk_count: 2 }, academic: { at_risk_count: 3 } })).toBe(5);
    expect(studentsAtRiskCount(undefined)).toBe(0);
  });

  it('finds exams open for marks and upcoming ones', () => {
    const exams = [
      { id: 1, name: 'a', status: 'PUBLISHED' }, { id: 2, name: 'b', status: 'SCHEDULED' },
      { id: 3, name: 'c', status: 'DRAFT' }, { id: 4, name: 'd', status: 'COMPLETED' },
    ];
    expect(examsAwaitingMarks(exams)).toBe(1);
    expect(upcomingExams(exams).map((e) => e.id)).toEqual([1, 2]);
    expect(upcomingExams(exams, 1)).toHaveLength(1);
  });

  it('formats minutes', () => {
    expect(minutesLabel(45)).toBe('45 min');
    expect(minutesLabel(75)).toBe('1h 15m');
  });
});

describe('buildTeacherAttention', () => {
  const base = {
    isModuleEnabled: () => true,
    isOffDay: false,
    pendingAttendanceClasses: 2,
    submissionsToGrade: 4,
    examsAwaitingMarks: 1,
    studentsAtRisk: 3,
    routes: { attendance: '/a', marks: '/m' },
  };
  const keys = (items: { key: string }[]) => items.map((i) => i.key);

  it('lists attendance first, then the amber items', () => {
    expect(keys(buildTeacherAttention(base))).toEqual(['att', 'marks', 'grade', 'risk']);
  });

  it('drops the attendance to-do on an OFF day', () => {
    expect(keys(buildTeacherAttention({ ...base, isOffDay: true }))).not.toContain('att');
  });

  it('skips modules that are off and omits zeros', () => {
    const items = buildTeacherAttention({ ...base, isModuleEnabled: (k) => k === 'attendance', examsAwaitingMarks: 0, studentsAtRisk: 0 });
    expect(keys(items)).toEqual(['att']);
  });

  it('only links where a mobile screen exists', () => {
    const items = buildTeacherAttention(base);
    expect(items.find((i) => i.key === 'att')?.href).toBe('/a');
    expect(items.find((i) => i.key === 'grade')?.href).toBeUndefined();
  });
});
