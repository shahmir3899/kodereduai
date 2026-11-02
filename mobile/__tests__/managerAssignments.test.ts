import { buildPayload, emptyForm, validateForm } from '../services/assignments';
import { buildDiaryPayloads, validateDiary } from '../services/dailyDiary';

const filled = () => ({
  ...emptyForm(), title: 'Fractions', classId: 3, subject: 7, description: 'Do page 4', due_date: '2026-11-20',
  status: 'PUBLISHED' as const, teacher: 99,
});

describe('assignment form for a manager', () => {
  it('needs a teacher for everyone else but not for a manager', () => {
    const form = { ...filled(), teacher: null };
    expect(validateForm(form)).toBe('Please select a teacher');
    expect(validateForm(form, { teacherRequired: false })).toBeNull();
  });

  it('still asks for the other required fields', () => {
    expect(validateForm({ ...filled(), subject: null }, { teacherRequired: false })).toBe('Please select a subject');
  });

  it('sends a draft with no teacher when draft-only, and the chosen values otherwise', () => {
    const input = { form: filled(), masterClassId: 3, sessionClassId: null, academicYearId: 5 };
    const manager = buildPayload({ ...input, draftOnly: true });
    expect(manager.status).toBe('DRAFT');
    expect('teacher' in manager).toBe(false);
    const teacher = buildPayload(input);
    expect(teacher.status).toBe('PUBLISHED');
    expect(teacher.teacher).toBe(99);
  });
});

describe('daily diary for a manager', () => {
  const entries = [{ subject: { id: 7, name: 'Maths' }, details: 'Read chapter 3' }];

  it('does not need a teacher when the role does not pick one', () => {
    expect(validateDiary(3, '2026-11-02', entries, null)).toBe('Please select a teacher');
    expect(validateDiary(3, '2026-11-02', entries, null, false)).toBeNull();
  });

  it('leaves the teacher out of every payload and keeps them drafts', () => {
    const rows = buildDiaryPayloads({ entries, date: '2026-11-02', masterClassId: 3, sessionClassId: null, teacherId: null });
    expect(rows).toHaveLength(1);
    expect('teacher' in rows[0]).toBe(false);
    expect(rows[0].status).toBe('DRAFT');
    expect(buildDiaryPayloads({ entries, date: '2026-11-02', masterClassId: 3, sessionClassId: null, teacherId: 12 })[0].teacher).toBe(12);
  });
});
