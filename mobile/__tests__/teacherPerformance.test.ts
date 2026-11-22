import {
  bandTone, describeMissed, exportFileName, formatScore, infoRows, monthRange, ordinal, orderedMeasures,
  positionText, scoreLevel, type Measure,
} from '../services/teacherPerformance';
import { personaFor } from '../navigation/personas';
import { buildStaffNavigation, collectWebPaths, type NavContext } from '../navigation/navConfig';
import { routeFor } from '../navigation/routes';

describe('teacher performance helpers', () => {
  it('builds whole calendar months and steps back across a year end', () => {
    const today = new Date(2026, 0, 17);
    expect(monthRange(0, today)).toMatchObject({ start: '2026-01-01', end: '2026-01-31' });
    expect(monthRange(-1, today)).toMatchObject({ start: '2025-12-01', end: '2025-12-31' });
    expect(monthRange(1, today)).toMatchObject({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('maps bands to pill tones', () => {
    expect(bandTone({ key: 'EXCELLENT', label: 'Excellent' })).toBe('success');
    expect(bandTone({ key: 'NEEDS_ATTENTION', label: 'Needs attention' })).toBe('error');
    expect(bandTone(null)).toBe('neutral');
  });

  it('formats scores, ordinals and positions', () => {
    expect(formatScore(82.44)).toBe('82.4');
    expect(formatScore(null)).toBe('—');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st'],
    );
    expect(positionText(5, 22)).toBe('5th of 22');
    expect(positionText(5, null)).toBe('');      // school hides positions
    expect(positionText(null, 22)).toBe('');
  });

  it('orders measures as the plan does and skips missing ones', () => {
    const m = (key: string) => ({ key } as Measure);
    expect(orderedMeasures({ login_days: m('login_days'), attendance_marking: m('attendance_marking') }).map((x) => x.key))
      .toEqual(['attendance_marking', 'login_days']);
  });

  it('describes missed items from any measure', () => {
    expect(describeMissed({ date: '2026-11-03', section: 'Class 4 - A', reason: 'not marked' })).toBe('2026-11-03 · Class 4 - A · not marked');
    expect(describeMissed({ assignment: 'Essay', student: 'Ali', reason: 'not graded' })).toBe('Essay (Ali) · not graded');
  });

  it('colours bars by score', () => {
    expect([90, 70, 40, null].map(scoreLevel)).toEqual(['good', 'mid', 'low', 'low']);
  });

  it('lists the information figures', () => {
    expect(infoRows({
      syllabus_on_schedule: { planned: 8, taught_on_time: 5 }, questions_added: 3,
      class_result_average: 71.2, marks_counted: 40, leave_days: 2,
    }).map((r) => r.value)).toEqual(['5 of 8', '71.2% (40 marks)', '3', '2']);
    expect(infoRows({ syllabus_on_schedule: { planned: 0, taught_on_time: 0 }, class_result_average: null })).toEqual([]);
  });

  it('names export files by period', () => {
    expect(exportFileName('2026-11-01', '2026-11-30', 'xlsx')).toBe('teacher-performance-2026-11-01-to-2026-11-30.xlsx');
  });
});

function ctxFor(role: string): NavContext {
  const persona = personaFor(role);
  return {
    persona, effectiveRole: role, isModuleEnabled: () => true, isStaffLevel: persona !== 'admin',
    isManager: role === 'MANAGER', isTeacher: role === 'TEACHER', isStaff: role === 'STAFF', isDriver: role === 'DRIVER',
    isSchoolAdminNav: persona === 'admin', hasInventoryAssignments: true,
  };
}
const navFor = (role: string) => collectWebPaths(buildStaffNavigation(ctxFor(role)));

describe('teacher performance menus', () => {
  it('teachers get My Performance, and it opens their own screen', () => {
    expect(navFor('TEACHER')).toContain('/my-performance');
    expect(routeFor('teacher', '/my-performance')).toBe('/(teacher)/my-performance');
  });

  it('admins and principals get the school report', () => {
    for (const role of ['SCHOOL_ADMIN', 'PRINCIPAL']) expect(navFor(role)).toContain('/hr/teacher-performance');
    expect(routeFor('admin', '/hr/teacher-performance')).toBe('/(admin)/hr/teacher-performance');
  });

  it('managers see neither', () => {
    const nav = navFor('MANAGER');
    expect(nav).not.toContain('/my-performance');
    expect(nav).not.toContain('/hr/teacher-performance');
  });
});
