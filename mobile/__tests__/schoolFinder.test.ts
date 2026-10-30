import {
  DIRECTORY_SHOW, filterDirectory, isValidCode, lookupFailureText, parseSchoolCode, preferredSchool, schoolLink, searchHint, type PublicSchool,
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

describe('search the downloaded list', () => {
  const list: PublicSchool[] = [
    { subdomain: 'focus', name: 'The Focus Montessori and School - Branch 1' },
    { subdomain: 'focus2', name: 'The Focus Montessori and School - Branch 2' },
    { subdomain: 'oakwood', name: 'Oakwood Academy' },
    { subdomain: 'beacon', name: 'Beacon House Focus Campus' },
    { subdomain: 'zed', name: 'Zed School' },
  ];
  const codes = (text: string) => filterDirectory(list, text).map((s) => s.subdomain);

  it('finds both Focus branches, and works from the first letters', () => {
    expect(codes('focus')).toEqual(['focus', 'focus2', 'beacon']);
    expect(codes('f')).toEqual(['focus', 'focus2', 'beacon']);
    expect(codes('the foc')).toEqual(['focus', 'focus2']);
  });

  it('puts names that start with the text first, then words, then codes, then the rest', () => {
    expect(codes('oak')).toEqual(['oakwood']);
    expect(codes('house')).toEqual(['beacon']);
    expect(codes('mont')).toEqual(['focus', 'focus2']);
    expect(codes('ood')).toEqual(['oakwood']);
  });

  it('ignores case and spaces around the text', () => {
    expect(codes('  FOCUS ')).toEqual(['focus', 'focus2', 'beacon']);
  });

  it('finds a school by the code it was given', () => {
    expect(codes('focus2')).toEqual(['focus2']);
  });

  it('shows nothing for empty text and nothing for a miss', () => {
    expect(codes('')).toEqual([]);
    expect(codes('   ')).toEqual([]);
    expect(codes('xyz')).toEqual([]);
  });

  it('shows at most a screenful', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ subdomain: `s${i}`, name: `School ${i}` }));
    expect(filterDirectory(many, 'school')).toHaveLength(DIRECTORY_SHOW);
    expect(filterDirectory(many, 'school', 5)).toHaveLength(5);
  });

  it('explains an empty directory and an empty box', () => {
    expect(searchHint('', 0)).toMatch(/chosen to be listed/);
    expect(searchHint('', 4)).toMatch(/Type your school/);
    expect(searchHint('foc', 4)).toBe('');
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
