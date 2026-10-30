import { personaFor } from '../navigation/personas';
import { buildDriverNavigation, buildStaffNavigation, collectWebPaths, type NavContext } from '../navigation/navConfig';
import { MODULES, type ModuleKey } from '../constants/modules';

// Role x module matrix. navConfig.test.ts spells out what each role sees; this walks every role
// against every module switched off and checks the rules that must hold for ALL of them.
// Accountant, Staff and Principal are left out until Phase 7 is final.

const ROLES = ['SCHOOL_ADMIN', 'TEACHER', 'MANAGER', 'DRIVER'] as const;
const ALL_MODULES = Object.values(MODULES) as ModuleKey[];

function ctxFor(role: string, enabled: Set<ModuleKey>): NavContext {
  const persona = personaFor(role);
  return {
    persona,
    effectiveRole: role,
    isModuleEnabled: (k) => enabled.has(k),
    isStaffLevel: persona !== 'admin',
    isManager: role === 'MANAGER',
    isTeacher: role === 'TEACHER',
    isStaff: role === 'STAFF',
    isDriver: role === 'DRIVER',
    isSchoolAdminNav: persona === 'admin',
    hasInventoryAssignments: true,
  };
}

const pathsFor = (role: string, enabled: Set<ModuleKey>) =>
  collectWebPaths(buildStaffNavigation(ctxFor(role, enabled)));

const without = (...off: ModuleKey[]) => new Set(ALL_MODULES.filter((m) => !off.includes(m)));
const everything = new Set(ALL_MODULES);

// Web path prefixes that belong only to one module. A module that is off must take all of them away.
const MODULE_PATHS: Partial<Record<ModuleKey, string[]>> = {
  attendance: ['/attendance', '/face-attendance'],
  finance: ['/finance'],
  hr: ['/hr'],
  academics: ['/academics', '/assessments'],
  students: ['/students', '/classes'],
  notifications: ['/notifications'],
  admissions: ['/admissions'],
  transport: ['/transport'],
  library: ['/library'],
  hostel: ['/hostel'],
  inventory: ['/inventory'],
};

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

describe('a module switched off removes its screens for every role', () => {
  for (const role of ROLES) {
    for (const [mod, prefixes] of Object.entries(MODULE_PATHS) as Array<[ModuleKey, string[]]>) {
      it(`${role} without ${mod}`, () => {
        const paths = pathsFor(role, without(mod));
        const leaked = paths.filter((p) => prefixes.some((pre) => under(p, pre)));
        expect(leaked).toEqual([]);
      });
    }
  }
});

describe('turning a module off never adds a screen', () => {
  for (const role of ROLES) {
    it(role, () => {
      const full = new Set(pathsFor(role, everything));
      for (const mod of ALL_MODULES) {
        for (const p of pathsFor(role, without(mod))) expect(full.has(p)).toBe(true);
      }
    });
  }
});

describe('every role keeps a way home and to messages, even with all modules off', () => {
  for (const role of ROLES) {
    it(role, () => {
      const paths = pathsFor(role, new Set());
      expect(paths).toContain('/dashboard');
      expect(paths).toContain('/messages');
    });
  }
});

describe('role restrictions hold with every module on', () => {
  const manager = pathsFor('MANAGER', everything);
  const teacher = pathsFor('TEACHER', everything);
  const driver = pathsFor('DRIVER', everything);
  const admin = pathsFor('SCHOOL_ADMIN', everything);

  it('manager has no student attendance, finance, student list, transport, library, inventory or hostel', () => {
    const banned = ['/attendance', '/face-attendance', '/finance', '/students', '/transport', '/library', '/inventory', '/hostel', '/admissions'];
    expect(manager.filter((p) => banned.some((b) => under(p, b)))).toEqual([]);
  });

  it('teacher gets Collect Payments only from Finance, and no admin-only screens', () => {
    expect(teacher.filter((p) => under(p, '/finance'))).toEqual(['/finance/fees/collect']);
    const banned = [
      '/face-attendance', '/hostel', '/admissions', '/hr/staff', '/hr/payroll', '/hr/salary',
      '/academics/subjects', '/academics/exams', '/academics/exam-types', '/academics/grade-scale',
      '/academics/analytics', '/students/risk-score', '/students/deleted',
    ];
    expect(teacher.filter((p) => banned.some((b) => under(p, b)))).toEqual([]);
  });

  it('driver sees transport and self service only', () => {
    const banned = ['/academics', '/assessments', '/finance', '/students', '/classes', '/attendance', '/admissions', '/hostel', '/library', '/inventory'];
    expect(driver.filter((p) => banned.some((b) => under(p, b)))).toEqual([]);
    const own = buildDriverNavigation(() => true).flatMap((g) => g.items.map((i) => i.webPath));
    expect(own.filter((p) => banned.some((b) => under(p, b)))).toEqual([]);
  });

  it('admin keeps what the others lose', () => {
    expect(admin).toEqual(expect.arrayContaining(['/face-attendance', '/finance/fees/setup', '/students/deleted', '/hr/staff']));
  });
});
