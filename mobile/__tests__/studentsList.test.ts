import { STATUS_SCOPES, infoSections, studentListParams } from '../services/students';

describe('studentListParams status scope', () => {
  const base = { term: '', option: null, academicYearId: 1, page: 1 };

  it('leaves the server default alone for current and when not given', () => {
    expect(studentListParams(base)).not.toHaveProperty('status_scope');
    expect(studentListParams({ ...base, statusScope: 'current' })).not.toHaveProperty('status_scope');
  });

  it.each(['left', 'graduated', 'repeat', 'all'] as const)('sends %s', (scope) => {
    expect(studentListParams({ ...base, statusScope: scope }).status_scope).toBe(scope);
  });

  it('offers the same five scopes as the web, current first', () => {
    expect(STATUS_SCOPES.map((s) => s.value)).toEqual(['current', 'left', 'graduated', 'repeat', 'all']);
  });
});

describe('infoSections', () => {
  const student = {
    gender: 'MALE', date_of_birth: '2020-01-05', blood_group: '', address: ' House 10 ',
    parent_name: 'Mr Ali', parent_phone: '+923001234567', guardian_phone: '', emergency_contact: '0300-1',
    admission_number: 'A-1', school_name: 'Demo School',
  };

  it('groups the rows, drops empty ones and spells out gender', () => {
    const sections = infoSections(student);
    expect(sections.map((s) => s.title)).toEqual(['Personal', 'Parent and guardian', 'Admission']);
    expect(sections[0].rows).toEqual([
      { label: 'Gender', value: 'Male' }, { label: 'Date of birth', value: '2020-01-05' }, { label: 'Address', value: 'House 10' },
    ]);
  });

  it('flags the phone rows so the screen can offer a call', () => {
    const rows = infoSections(student).flatMap((s) => s.rows).filter((r) => r.phone);
    expect(rows.map((r) => r.label)).toEqual(['Parent phone', 'Emergency contact']);
  });

  it('leaves out a section with nothing in it', () => {
    expect(infoSections({ gender: 'F' }).map((s) => s.title)).toEqual(['Personal']);
    expect(infoSections(null)).toEqual([]);
  });
});
