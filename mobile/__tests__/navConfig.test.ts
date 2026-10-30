import fs from 'fs';
import path from 'path';
import { personaFor, homeRouteFor, type Persona } from '../navigation/personas';
import { buildAccountantNavigation, buildDriverNavigation, buildParentNavigation, buildStaffNavigation, buildStudentNavigation, collectWebPaths, type NavContext } from '../navigation/navConfig';
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

describe('accountant on mobile', () => {
  const groups = buildAccountantNavigation(() => true);
  const items = groups.flatMap((g) => g.items);
  const paths = items.map((i) => i.webPath);

  it('is read-only finance, messages, own HR and password', () => {
    expect(paths).toEqual(expect.arrayContaining([
      '/dashboard', '/finance', '/finance/accounts', '/finance/fees', '/finance/income', '/finance/expenses',
      '/messages', '/notifications', '/hr/leave', '/hr/attendance', '/hr/payslips',
    ]));
  });
  it('has no write or non-finance entries (the finance API is read-only for this role)', () => {
    for (const p of ['/finance/fees/collect', '/finance/fees/setup', '/finance/discounts', '/academics/timetable', '/students', '/attendance/manual-entry', '/transport']) {
      expect(paths).not.toContain(p);
    }
  });
  it('gets read-only inventory: dashboard, items, movements, assignments and reorder', () => {
    expect(paths).toEqual(expect.arrayContaining(['/inventory', '/inventory/items', '/inventory/transactions', '/inventory/assignments', '/inventory/reorder-prediction']));
    expect(buildAccountantNavigation((k) => k !== 'inventory').flatMap((g) => g.items.map((i) => i.webPath))).not.toContain('/inventory');
  });
  it('has a screen for every entry, inside the accountant shell', () => {
    const appDir = path.join(__dirname, '..', 'app');
    expect(items.filter((i) => !i.href)).toEqual([]);
    for (const it of items) {
      expect(it.href).toMatch(/^\/\(accountant\)\//);
      expect(['.tsx', '/index.tsx'].some((ext) => fs.existsSync(path.join(appDir, it.href as string) + ext))).toBe(true);
    }
  });
  it('drops finance and HR groups when the modules are off', () => {
    const off = buildAccountantNavigation((k) => k !== 'finance' && k !== 'hr').flatMap((g) => g.items.map((i) => i.webPath));
    expect(off).not.toContain('/finance');
    expect(off).not.toContain('/hr/leave');
  });
});

describe('staff on mobile', () => {
  const items = buildStaffNavigation(ctxFor('STAFF')).flatMap((g) => g.items);
  it('has a screen for every entry, inside the staff shell', () => {
    const appDir = path.join(__dirname, '..', 'app');
    expect(items.filter((i) => !i.href)).toEqual([]);
    for (const it of items) {
      expect(it.href).toMatch(/^\/\(staff\)\//);
      expect(['.tsx', '/index.tsx'].some((ext) => fs.existsSync(path.join(appDir, it.href as string) + ext))).toBe(true);
    }
  });
  it('lists inventory only when something is assigned', () => {
    const withIt = buildStaffNavigation(ctxFor('STAFF')).flatMap((g) => g.items.map((i) => i.webPath));
    const without = buildStaffNavigation(ctxFor('STAFF', { hasInventoryAssignments: false })).flatMap((g) => g.items.map((i) => i.webPath));
    expect(withIt).toContain('/inventory/assignments');
    expect(without).not.toContain('/inventory/assignments');
  });
  it('leaves out the transport and library groups the web sidebar lists for staff', () => {
    const paths = items.map((i) => i.webPath);
    expect(paths).not.toContain('/transport');
    expect(paths).not.toContain('/library');
  });
  it('adds payslips and change password to the web self-service set', () => {
    expect(items.map((i) => i.webPath)).toEqual(expect.arrayContaining(['/hr/self-service', '/hr/payslips', '/staff/change-password']));
  });
});

describe('principal', () => {
  // The web gives PRINCIPAL the admin sidebar and lets it through every AdminPrincipalRoute guard
  // (face attendance, school setup, settings); the differences are all server-side.
  const nav = navFor('PRINCIPAL', { isStaffLevel: false, isSchoolAdminNav: true });
  it('shares the admin shell', () => {
    expect(personaFor('PRINCIPAL')).toBe('admin');
  });
  it('sees face attendance, fee setup, full HR and recently deleted students', () => {
    expect(nav).toEqual(expect.arrayContaining(['/face-attendance', '/finance/fees/setup', '/hr/payroll', '/students/deleted']));
  });
});

describe('inventory by role', () => {
  const FULL = ['/inventory', '/inventory/items', '/inventory/transactions', '/inventory/assignments', '/inventory/reorder-prediction'];
  it('gives admin and principal the full inventory group, each with an admin screen', () => {
    for (const role of ['SCHOOL_ADMIN', 'PRINCIPAL']) {
      const groups = buildStaffNavigation(ctxFor(role, { isStaffLevel: false, isSchoolAdminNav: true, persona: 'admin' }));
      const items = groups.flatMap((g) => g.items).filter((i) => i.webPath.startsWith('/inventory'));
      expect(items.map((i) => i.webPath)).toEqual(FULL);
      for (const it of items) expect(it.href).toMatch(/^\/\(admin\)\/inventory/);
    }
  });
  it('gives teacher and staff only their own assignments, and the manager nothing', () => {
    expect(navFor('TEACHER').filter((p) => p.startsWith('/inventory'))).toEqual(['/inventory/assignments']);
    expect(navFor('STAFF').filter((p) => p.startsWith('/inventory'))).toEqual(['/inventory/assignments']);
    expect(navFor('MANAGER').filter((p) => p.startsWith('/inventory'))).toEqual([]);
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

describe('admissions by role', () => {
  const PATHS = ['/admissions', '/admissions/conversion-likelihood'];
  it('gives admin and principal the enquiries and likelihood screens, each with an admin route', () => {
    for (const role of ['SCHOOL_ADMIN', 'PRINCIPAL']) {
      const groups = buildStaffNavigation(ctxFor(role, { isStaffLevel: false, isSchoolAdminNav: true, persona: 'admin' }));
      const items = groups.flatMap((g) => g.items).filter((i) => i.webPath.startsWith('/admissions'));
      expect(items.map((i) => i.webPath)).toEqual(PATHS);
      for (const it of items) expect(it.href).toMatch(/^\/\(admin\)\/admissions/);
    }
  });
  it('hides them when the admissions module is off', () => {
    const groups = buildStaffNavigation(ctxFor('SCHOOL_ADMIN', { isModuleEnabled: (k: string) => k !== 'admissions' }));
    expect(collectWebPaths(groups).filter((p) => p.startsWith('/admissions'))).toEqual([]);
  });
  it('shows nothing to any other role (the server refuses their writes and the scores)', () => {
    for (const role of ['TEACHER', 'MANAGER', 'ACCOUNTANT', 'STAFF', 'DRIVER']) {
      expect(navFor(role).filter((p) => p.startsWith('/admissions'))).toEqual([]);
    }
  });
});
