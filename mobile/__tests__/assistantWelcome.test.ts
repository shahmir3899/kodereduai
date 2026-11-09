import { buildWelcome, welcomeLanguage } from '../services/assistantWelcome';

const admin = [{ name: 'finance', label: 'Finance', can_write: true }, { name: 'attendance', label: 'Attendance', can_write: true }];
const parent = [{ name: 'family', label: 'My children', can_write: false }];

describe('welcome text', () => {
  it('names what the role can do and says changes need approval', () => {
    const t = buildWelcome(admin, 'en');
    expect(t).toContain("I'm Aura");
    expect(t).toContain('Finance and Attendance');
    expect(t).toContain('you always approve them');
  });

  it('never tells a read-only role it can prepare changes', () => {
    const t = buildWelcome(parent, 'en');
    expect(t).toContain('My children');
    expect(t).not.toMatch(/prepare changes/i);
  });

  it('names only the first four and then says "and more"', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: n, label: n.toUpperCase() }));
    expect(buildWelcome(many, 'en')).toContain('A, B, C, D and more');
  });

  it('gives Urdu script for Urdu, using the Urdu topic names', () => {
    const t = buildWelcome(admin, 'ur');
    expect(t).toMatch(/[؀-ۿ]/);
    expect(t).toContain('فیس اور مالیات');
    expect(t).not.toContain('Finance');
  });

  it('returns nothing when there is nothing to offer', () => {
    expect(buildWelcome([], 'en')).toBe('');
    expect(buildWelcome(null, 'ur')).toBe('');
  });
});

describe('welcome language', () => {
  it('prefers the saved choice, then the phone language, else English', () => {
    expect(welcomeLanguage('ur', 'en-US')).toBe('ur');
    expect(welcomeLanguage('en', 'ur-PK')).toBe('en');
    expect(welcomeLanguage(null, 'ur-PK')).toBe('ur');
    expect(welcomeLanguage(null, 'en-GB')).toBe('en');
    expect(welcomeLanguage(undefined, '')).toBe('en');
  });
});
