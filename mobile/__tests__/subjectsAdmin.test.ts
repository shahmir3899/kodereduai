import {
  buildClassSubjectPayload, buildClassTeacherPayload, buildSubjectPayload, classSubjectSubtitle, classSubjectToForm, emptyClassSubjectForm,
  emptySubjectForm, subjectSubtitle, subjectToForm, totalPeriods, unassignedSubjects, validateClassSubject, validateClassTeacher, validateSubject,
  type ClassSubjectRow, type ClassTeacherRow, type Subject,
} from '../services/subjectsAdmin';

const subject = (over: Partial<Subject> = {}): Subject => ({ id: 1, name: 'Maths', code: 'MATH', is_elective: false, is_active: true, ...over });
const cs = (over: Partial<ClassSubjectRow> = {}): ClassSubjectRow => ({ id: 1, class_obj: 5, session_class: 9, subject: 1, subject_name: 'Maths', teacher: 3, teacher_name: 'Ali', periods_per_week: 5, is_active: true, ...over });

describe('subject form', () => {
  it('needs a name and a code of 20 characters at most', () => {
    expect(validateSubject(emptySubjectForm())).toMatch(/name/);
    expect(validateSubject({ ...emptySubjectForm(), name: 'Maths' })).toMatch(/code/);
    expect(validateSubject({ ...emptySubjectForm(), name: 'Maths', code: 'X'.repeat(21) })).toMatch(/20/);
    expect(validateSubject({ ...emptySubjectForm(), name: 'Maths', code: 'math' })).toBeNull();
  });

  it('upper-cases the code and sends is_active only on edit', () => {
    const f = { ...emptySubjectForm(), name: ' Maths ', code: ' math ', isElective: true };
    expect(buildSubjectPayload(f, true)).toEqual({ name: 'Maths', code: 'MATH', description: '', is_elective: true });
    expect(buildSubjectPayload({ ...f, isActive: false }, false)).toMatchObject({ is_active: false });
    expect(subjectToForm(subject({ description: null }))).toMatchObject({ name: 'Maths', description: '', isActive: true });
    expect(subjectSubtitle(subject({ is_elective: true }))).toBe('MATH  ·  Elective');
  });
});

describe('subjects of a section', () => {
  it('needs a subject and 1 to 20 periods', () => {
    expect(validateClassSubject(emptyClassSubjectForm())).toMatch(/subject/);
    expect(validateClassSubject({ subject: 1, teacher: null, periods: '0' })).toMatch(/1 to 20/);
    expect(validateClassSubject({ subject: 1, teacher: null, periods: '21' })).toMatch(/1 to 20/);
    expect(validateClassSubject({ subject: 1, teacher: null, periods: '2.5' })).toMatch(/1 to 20/);
    expect(validateClassSubject({ subject: 1, teacher: null, periods: '5' })).toBeNull();
  });

  it('addresses a section by its session class, else the master class', () => {
    const f = { subject: 2, teacher: 7, periods: '4' };
    expect(buildClassSubjectPayload(f, { sessionClass: 9, classObj: 5, academicYear: 3 })).toEqual({ session_class: 9, academic_year: 3, subject: 2, teacher: 7, periods_per_week: 4 });
    expect(buildClassSubjectPayload(f, { sessionClass: null, classObj: 5, academicYear: null })).toEqual({ class_obj: 5, subject: 2, teacher: 7, periods_per_week: 4 });
    expect(classSubjectToForm(cs())).toEqual({ subject: 1, teacher: 3, periods: '5' });
  });

  it('offers only subjects not yet given, but keeps the one being edited', () => {
    const all = [subject(), subject({ id: 2, name: 'English', code: 'ENG' }), subject({ id: 3, name: 'Old', code: 'OLD', is_active: false })];
    expect(unassignedSubjects(all, [cs()]).map((s) => s.id)).toEqual([2]);
    expect(unassignedSubjects(all, [cs()], 1).map((s) => s.id)).toEqual([1, 2]);
  });

  it('totals the periods and words a row', () => {
    expect(totalPeriods([cs(), cs({ id: 2, periods_per_week: 3 }), cs({ id: 3, periods_per_week: 9, is_active: false })])).toBe(8);
    expect(classSubjectSubtitle(cs())).toBe('Ali  ·  5 periods a week');
    expect(classSubjectSubtitle(cs({ teacher_name: null, periods_per_week: 1 }))).toBe('No teacher yet  ·  1 period a week');
  });
});

describe('class teacher', () => {
  const scope = { sessionClass: 9, classObj: 5, academicYear: 3 };
  const rows: ClassTeacherRow[] = [{ id: 1, session_class: 9, class_obj: 5, teacher: 4, is_active: true }];

  it('needs a teacher and a section, and refuses a repeat', () => {
    expect(validateClassTeacher(null, scope, rows)).toMatch(/teacher/);
    expect(validateClassTeacher(7, { ...scope, sessionClass: null }, rows)).toMatch(/section/);
    expect(validateClassTeacher(4, scope, rows)).toMatch(/already/);
    expect(validateClassTeacher(7, scope, rows)).toBeNull();
    expect(buildClassTeacherPayload(7, scope)).toEqual({ session_class: 9, teacher: 7, academic_year: 3 });
  });
});
