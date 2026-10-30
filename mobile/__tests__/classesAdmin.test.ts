import {
  buildMasterPayload, buildSessionPayload, canonicalMasters, classLabel, deleteWarning, emptyClassForm, linkedMaster, masterToForm, missingSections,
  sessionSubtitle, sessionToForm, sortSessionClasses, validateClassForm, withGrade, type MasterClass, type SessionClassRow,
} from '../services/classesAdmin';

const master = (over: Partial<MasterClass> = {}): MasterClass => ({ id: 1, name: 'Class 2', section: '', grade_level: 4, is_active: true, ...over });
const sc = (over: Partial<SessionClassRow> = {}): SessionClassRow => ({ id: 10, academic_year: 3, class_obj: 1, display_name: 'Class 2', section: 'A', grade_level: 4, is_active: true, ...over });

describe('class form', () => {
  it('fills the standard name from the grade level and keeps a custom one', () => {
    expect(withGrade(emptyClassForm(), '5')).toMatchObject({ grade: '5', name: 'Class 3' });
    expect(withGrade({ ...emptyClassForm(), name: 'Montessori' }, '40')).toMatchObject({ grade: '40', name: 'Montessori' });
  });

  it('needs a name and a numeric grade', () => {
    expect(validateClassForm(emptyClassForm())).toMatch(/name/);
    expect(validateClassForm({ name: 'X', grade: 'a', section: '' })).toMatch(/whole number/);
    expect(validateClassForm({ name: 'X', grade: '', section: '' })).toBeNull();
    expect(validateClassForm({ name: 'Class 2', grade: '4', section: 'A' })).toBeNull();
  });

  it('round-trips saved classes', () => {
    expect(masterToForm(master({ section: 'B' }))).toEqual({ name: 'Class 2', grade: '4', section: 'B' });
    expect(sessionToForm(sc())).toEqual({ name: 'Class 2', grade: '4', section: 'A' });
  });
});

describe('linking and payloads', () => {
  const masters = [master(), master({ id: 2, name: 'Class 2', section: 'A' }), master({ id: 3, name: 'Class 3', grade_level: 5 })];

  it('links only to a section-free master of the same name and grade', () => {
    expect(canonicalMasters(masters).map((m) => m.id)).toEqual([1, 3]);
    expect(linkedMaster(masters, ' class 2 ', 4)?.id).toBe(1);
    expect(linkedMaster(masters, 'Class 2', 5)).toBeNull();
  });

  it('builds a master payload with the school only on create and no section on create', () => {
    const f = { name: ' Class 4 ', grade: '6', section: ' B ' };
    expect(buildMasterPayload(f, 7, true)).toEqual({ school: 7, name: 'Class 4', section: '', grade_level: 6 });
    expect(buildMasterPayload(f, 7, false)).toEqual({ name: 'Class 4', section: 'B', grade_level: 6 });
    expect(buildMasterPayload({ name: 'Prep', grade: '', section: '' }, 7, true).grade_level).toBe(0);
  });

  it('builds a session payload linked to the matching master', () => {
    expect(buildSessionPayload({ name: 'Class 2', grade: '4', section: ' A ' }, 3, masters)).toEqual({ academic_year: 3, class_obj: 1, display_name: 'Class 2', section: 'A', grade_level: 4 });
    expect(buildSessionPayload({ name: 'Class 9', grade: '11', section: '' }, 3, masters).class_obj).toBeNull();
  });
});

describe('sections', () => {
  it('quick-add skips sections that exist', () => {
    const existing = [sc({ section: 'A' }), sc({ id: 11, section: 'b' }), sc({ id: 12, display_name: 'Class 3', section: 'C' })];
    expect(missingSections(existing, 'Class 2', ['A', 'B', 'C'])).toEqual(['C']);
    expect(missingSections([], 'Class 2', ['A'])).toEqual(['A']);
  });

  it('labels, sorts and describes sections', () => {
    expect(classLabel(sc())).toBe('Class 2 - A');
    expect(classLabel(sc({ section: '' }))).toBe('Class 2');
    expect(classLabel(sc({ label: 'Class 2 - A (Blue)' }))).toBe('Class 2 - A (Blue)');
    expect(sortSessionClasses([sc({ id: 2, grade_level: 5, display_name: 'Class 3' }), sc({ id: 1, section: 'B' }), sc()]).map((c) => c.id)).toEqual([10, 1, 2]);
    expect(sessionSubtitle(sc({ enrollment_count: 1 }))).toBe('1 student');
    expect(sessionSubtitle(sc({ enrollment_count: 30, unassigned_count: 2, class_obj: null }))).toBe('30 students  ·  2 without a section  ·  not linked to a master class');
  });

  it('warns before deleting a class with students', () => {
    expect(deleteWarning('Class 2 - A', 0)).toBe('Class 2 - A');
    expect(deleteWarning('Class 2 - A', 1)).toMatch(/1 student\./);
  });
});
