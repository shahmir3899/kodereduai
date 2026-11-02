import { buildScopeLookup, resolveScope } from '../services/teacherScope';

describe('teacher scope', () => {
  const lookup = buildScopeLookup(
    [{ class_obj: 1 }],
    [{ class_obj: 2, subject: 10 }, { class_obj: 1, subject: 11 }, { class_obj: null, subject: 5 }],
  );

  it('calls a class-wide assignment Class teacher, even when a subject is also held', () => {
    expect(resolveScope(lookup, 1, 99)?.kind).toBe('class');
    expect(resolveScope(lookup, 1, 11)?.detail).toMatch(/also hold the subject/);
    expect(resolveScope(lookup, '1')?.label).toBe('Class teacher');
  });

  it('calls a subject assignment inside another class Subject teacher', () => {
    expect(resolveScope(lookup, 2, 10)?.kind).toBe('subject');
  });

  it('says a class is only partly visible when no subject is chosen', () => {
    expect(resolveScope(lookup, 2)?.detail).toMatch(/partly visible/);
  });

  it('marks anything else out of scope, and gives nothing without a class', () => {
    expect(resolveScope(lookup, 2, 99)?.kind).toBe('out');
    expect(resolveScope(lookup, 3)?.kind).toBe('out');
    expect(resolveScope(lookup, null, 10)).toBeNull();
    expect(resolveScope(lookup, '', 10)).toBeNull();
  });
});
