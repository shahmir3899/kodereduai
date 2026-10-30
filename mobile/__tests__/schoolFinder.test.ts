import {
  isValidCode, lookupFailureText, parseSchoolCode, preferredSchool, schoolLink, searchHint, shouldSearch,
} from '../services/schoolFinder';

describe('school code', () => {
  it('accepts plain codes, in any case', () => {
    expect(parseSchoolCode('demo')).toBe('demo');
    expect(parseSchoolCode('  Oak-Wood  ')).toBe('oak-wood');
    expect(parseSchoolCode('school42')).toBe('school42');
  });

  it('reads the app link, and that is what the QR code carries', () => {
    expect(parseSchoolCode(schoolLink('demo'))).toBe('demo');
    expect(parseSchoolCode('EDUCATIONAI://school/Demo/extra?x=1')).toBe('demo');
    expect(schoolLink('demo')).toBe('educationai://school/demo');
  });

  it('reads a school web address under our domains only', () => {
    expect(parseSchoolCode('https://demo.educationai.pk')).toBe('demo');
    expect(parseSchoolCode('https://demo.educationai.pk/login?a=1')).toBe('demo');
    expect(parseSchoolCode('http://focus.kodereduai.pk')).toBe('focus');
    expect(parseSchoolCode('https://demo.educationai.com.pk/')).toBe('demo');
    expect(parseSchoolCode('https://demo.evil.com')).toBeNull();
    expect(parseSchoolCode('https://educationai.pk')).toBeNull();
    expect(parseSchoolCode('https://www.educationai.pk')).toBeNull();
  });

  it('refuses anything that is not a code', () => {
    ['', '   ', null, undefined, 'two words', '-bad', 'a/b', 'www', 'api', 'localhost', 'WIFI:T:WPA;S:x;;', 'tel:+92300', 'x'.repeat(64)]
      .forEach((v) => expect(parseSchoolCode(v as string)).toBeNull());
    expect(isValidCode('demo')).toBe(true);
    expect(isValidCode('www')).toBe(false);
  });
});

describe('search', () => {
  it('starts at three letters and says why not before that', () => {
    expect(shouldSearch('oa')).toBe(false);
    expect(shouldSearch(' oa ')).toBe(false);
    expect(shouldSearch('oak')).toBe(true);
    expect(searchHint('')).toMatch(/Type your school/);
    expect(searchHint('oa')).toMatch(/at least 3/);
    expect(searchHint('oak')).toBe('');
  });
});

describe('active school after sign-in', () => {
  const schools = [{ id: 1, subdomain: 'alpha', is_default: true }, { id: 2, subdomain: 'Demo', is_default: false }];

  it('uses the school the person picked when they belong to it', () => {
    expect(preferredSchool(schools, 'demo')?.id).toBe(2);
  });

  it('falls back to the default, then the first', () => {
    expect(preferredSchool(schools, 'other')?.id).toBe(1);
    expect(preferredSchool(schools, null)?.id).toBe(1);
    expect(preferredSchool([{ id: 3, subdomain: 'x' }], null)?.id).toBe(3);
    expect(preferredSchool([], 'demo')).toBeNull();
  });
});

describe('lookup errors', () => {
  it('explains each failure', () => {
    expect(lookupFailureText(new Error('x'))).toMatch(/reach the server/);
    expect(lookupFailureText({ response: { status: 404 } })).toMatch(/No school has this code/);
    expect(lookupFailureText({ response: { status: 429 } })).toMatch(/Too many/);
    expect(lookupFailureText({ response: { status: 500 } })).toMatch(/Could not look up/);
  });
});
