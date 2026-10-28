import fs from 'fs';
import path from 'path';
import { personaFor, homeRouteFor, type Persona } from '../navigation/personas';
import { buildDriverNavigation, buildParentNavigation, buildStaffNavigation, buildStudentNavigation, collectWebPaths, type NavContext } from '../navigation/navConfig';
import { routeFor } from '../navigation/routes';

function ctxFor(role: string, extra: Partial<NavContext> = {}): NavContext {
  const persona = personaFor(role);
  return {
    persona,
    effectiveRole: role,
    isModuleEnabled: () => true,
    isStaffLevel: persona !== 'admin',
    isManager: role === 'MANAGER',
    isTeacher: role === 'TEACHER',
    isStaff: role === 'STAFF',
    isDriver: role === 'DRIVER',
    isSchoolAdminNav: persona === 'admin',
    hasInventoryAssignments: true,
    ...extra,
  };
}

const navFor = (role: string, extra: Partial<NavContext> = {}) =>
  collectWebPaths(buildStaffNavigation(ctxFor(role, extra)));

describe('personaFor', () => {
  it.each([
    ['SUPER_ADMIN', 'admin'], ['SCHOOL_ADMIN', 'admin'], ['PRINCIPAL', 'admin'],
    ['TEACHER', 'teacher'], ['MANAGER', 'manager'], ['ACCOUNTANT', 'accountant'],
    ['STAFF', 'staff'], ['PARENT', 'parent'], ['STUDENT', 'student'], ['DRIVER', 'driver'],
  ])('%s -> %s', (role, persona) => {
    expect(personaFor(role)).toBe(persona);
  });

  it('treats a super admin flag as admin whatever the school role', () => {
    expect(personaFor('TEACHER', true)).toBe('admin');
  });

  it('falls back to the least-privileged shell for unknown roles', () => {
    expect(personaFor('SOMETHING_NEW')).toBe('staff');
    expect(personaFor(undefined)).toBe('staff');
  });

  it('builds the home route from the persona', () => {
    expect(homeRouteFor('teacher')).toBe('/(teacher)/dashboard');
  });
});

describe('manager', () => {
  const nav = navFor('MANAGER');
  it.each([
    '/attendance/manual-entry', '/finance', '/finance/fees/collect', '/students',
    '/transport', '/library', '/inventory', '/academics/curriculum-coverage', '/hostel',
  ])('does not show %s', (p) => expect(nav).not.toContain(p));

  it('keeps timetable, content creation, classes and own HR', () => {
    expect(nav).toEqual(expect.arrayContaining([
      '/academics/timetable', '/academics/paper-builder', '/academics/questions', '/classes', '/hr/leave', '/hr/attendance',
    ]));
  });
});

describe('manager screens', () => {
  const groups = buildStaffNavigation(ctxFor('MANAGER'));
  it('has a mobile screen for everything the web gives a Manager', () => {
    const missing = groups.flatMap((g) => g.items).filter((i) => !i.href).map((i) => i.webPath);
    expect(missing).toEqual([]);
  });
  it('stays inside the Manager shell', () => {
    for (const it of groups.flatMap((g) => g.items)) expect(it.href).toMatch(/^\/\(manager\)\//);
  });
  it('does not reach student data through any route', () => {
    const hrefs = groups.flatMap((g) => g.items).map((i) => i.href ?? '');
    expect(hrefs.some((h) => /students|attendance\/|fee|finance|marks|results|report-cards/.test(h))).toBe(false);
  });
});

describe('teacher', () => {
  const nav = navFor('TEACHER');
  it('marks attendance manually but has no face attendance', () => {
    expect(nav).toContain('/attendance/manual-entry');
    expect(nav).not.toContain('/face-attendance');
  });
  it('only collects payments under finance', () => {
    expect(nav).toContain('/finance/fees/collect');
    expect(nav).not.toContain('/finance');
    expect(nav).not.toContain('/finance/fees/setup');
  });
  it('has marks entry and report cards but no exam creation or subjects', () => {
    expect(nav).toEqual(expect.arrayContaining(['/academics/marks-entry', '/academics/report-cards', '/academics/exam-schedule']));
    expect(nav).not.toContain('/academics/exams');
    expect(nav).not.toContain('/academics/subjects');
  });
  it('sees inventory only when assigned items', () => {
    expect(nav).toContain('/inventory/assignments');
    expect(navFor('TEACHER', { hasInventoryAssignments: false })).not.toContain('/inventory/assignments');
  });
  it('gets only own leave and attendance from HR', () => {
    expect(nav).toEqual(expect.arrayContaining(['/hr/leave', '/hr/attendance']));
    expect(nav).not.toContain('/hr/payroll');
  });
});

describe('staff', () => {
  const nav = navFor('STAFF');
  it('is limited to self service, notifications and messages', () => {
    expect(nav).toEqual(expect.arrayContaining(['/dashboard', '/hr/self-service', '/messages', '/notifications']));
    for (const p of ['/finance', '/students', '/academics/timetable', '/attendance/manual-entry', '/classes']) {
      expect(nav).not.toContain(p);
    }
  });
});

describe('driver', () => {
  const nav = navFor('DRIVER');
  it('is transport, self service and messaging only', () => {
    expect(nav).toEqual(expect.arrayContaining(['/dashboard', '/transport', '/hr/self-service', '/notifications', '/messages']));
    for (const p of ['/finance', '/students', '/classes', '/academics/subjects', '/inventory/items']) {
      expect(nav).not.toContain(p);
    }
  });
});

describe('accountant', () => {
  const nav = navFor('ACCOUNTANT');
  it('gets the finance suite without admin-only setup', () => {
    expect(nav).toEqual(expect.arrayContaining(['/finance', '/finance/fees/collect', '/finance/income', '/finance/expenses']));
    expect(nav).not.toContain('/finance/fees/setup');
    expect(nav).not.toContain('/finance/discounts');
  });
  it('has no student attendance', () => {
    expect(nav).not.toContain('/attendance/manual-entry');
  });
});

describe('admin', () => {
  it('sees face attendance, fee setup and the full HR group', () => {
    const nav = navFor('SCHOOL_ADMIN');
    expect(nav).toEqual(expect.arrayContaining(['/face-attendance', '/finance/fees/setup', '/hr/payroll', '/admissions']));
  });
  it('sees recently deleted students only as school admin or principal', () => {
    expect(navFor('SCHOOL_ADMIN')).toContain('/students/deleted');
    expect(navFor('PRINCIPAL')).toContain('/students/deleted');
    expect(navFor('SUPER_ADMIN')).not.toContain('/students/deleted');
  });
});

describe('module gating', () => {
  it('hides a group when its module is off', () => {
    const nav = navFor('SCHOOL_ADMIN', { isModuleEnabled: (k) => k !== 'finance' });
    expect(nav).not.toContain('/finance');
    expect(nav).toContain('/students');
  });
  it('hides exam entries when examinations is off but keeps timetable', () => {
    const nav = navFor('TEACHER', { isModuleEnabled: (k) => k !== 'examinations' });
    expect(nav).not.toContain('/academics/marks-entry');
    expect(nav).toContain('/academics/timetable');
  });
});

describe('routes', () => {
  const personas: Persona[] = ['admin', 'teacher', 'manager', 'accountant', 'staff', 'parent', 'student', 'driver'];

  it('maps a dashboard route for every persona', () => {
    for (const p of personas) expect(routeFor(p, '/dashboard')).toBe(`/(${p})/dashboard`);
  });

  // A route row pointing at a missing file would crash on tap, so check the files exist.
  it('only maps web paths to screens that exist', () => {
    const appDir = path.join(__dirname, '..', 'app');
    const exists = (route: string) => {
      const base = path.join(appDir, route);
      return ['.tsx', '/index.tsx'].some((ext) => fs.existsSync(base + ext));
    };
    for (const p of personas) {
      for (const role of ['SCHOOL_ADMIN', 'TEACHER', 'MANAGER', 'ACCOUNTANT', 'STAFF', 'DRIVER']) {
        for (const g of buildStaffNavigation({ ...ctxFor(role), persona: p })) {
          for (const it of g.items) if (it.href) expect(exists(it.href)).toBe(true);
        }
      }
    }
  });
});

describe('student', () => {
  const items = buildStudentNavigation().flatMap((g) => g.items);
  it('mirrors the web student pages, all with a screen', () => {
    expect(items.filter((i) => !i.href)).toEqual([]);
    expect(items.map((i) => i.webPath)).toEqual(expect.arrayContaining([
      '/student/dashboard', '/student/attendance', '/student/fees', '/student/timetable', '/student/exam-schedule',
      '/student/results', '/student/assignments', '/student/library', '/student/transport', '/student/study-helper', '/student/profile',
    ]));
  });
  it('stays inside the student shell and the screens exist', () => {
    const appDir = path.join(__dirname, '..', 'app');
    for (const it of items) {
      expect(it.href).toMatch(/^\/\(student\)\//);
      const base = path.join(appDir, it.href as string);
      expect(['.tsx', '/index.tsx'].some((ext) => fs.existsSync(base + ext))).toBe(true);
    }
  });
});

describe('parent', () => {
  const items = buildParentNavigation().flatMap((g) => g.items);
  it('has the three web parent pages, all with a screen', () => {
    expect(items.filter((i) => !i.href)).toEqual([]);
    expect(items.map((i) => i.webPath)).toEqual(expect.arrayContaining(['/parent/dashboard', '/parent/leave', '/parent/messages']));
  });
  it('stays inside the parent shell and the screens exist', () => {
    const appDir = path.join(__dirname, '..', 'app');
    for (const it of items) {
      expect(it.href).toMatch(/^\/\(parent\)\//);
      const base = path.join(appDir, it.href as string);
      expect(['.tsx', '/index.tsx'].some((ext) => fs.existsSync(base + ext))).toBe(true);
    }
  });
  it('has no payment screen: the gateway was discontinued', () => {
    const appDir = path.join(__dirname, '..', 'app');
    expect(fs.existsSync(path.join(appDir, '(parent)', 'payment.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(appDir, 'payment-result.tsx'))).toBe(false);
  });
});

describe('driver', () => {
  const all = () => true;
  const items = buildDriverNavigation(all).flatMap((g) => g.items);
  it('has a screen for every item and stays inside the driver shell', () => {
    const appDir = path.join(__dirname, '..', 'app');
    expect(items.filter((i) => !i.href)).toEqual([]);
    for (const it of items) {
      expect(it.href).toMatch(/^\/\(driver\)\//);
      const base = path.join(appDir, it.href as string);
      expect(['.tsx', '/index.tsx'].some((ext) => fs.existsSync(base + ext))).toBe(true);
    }
  });
  it('is transport and own HR only: no students, finance or academics', () => {
    const hrefs = items.map((i) => i.href ?? '').join(' ');
    expect(hrefs).not.toMatch(/students|finance|marks|results|attendance\/|fees|hr\/staff/);
    expect(items.map((i) => i.webPath)).toEqual(expect.arrayContaining(['/transport/journey', '/transport/boarding', '/hr/leave']));
  });
  it('hides boarding when transport is off and HR when hr is off', () => {
    const off = (m: string) => (key: string) => key !== m;
    const noTransport = buildDriverNavigation(off('transport') as never).flatMap((g) => g.items).map((i) => i.webPath);
    expect(noTransport).not.toContain('/transport/boarding');
    const noHr = buildDriverNavigation(off('hr') as never).flatMap((g) => g.items).map((i) => i.webPath);
    expect(noHr).not.toContain('/hr/leave');
  });
});
