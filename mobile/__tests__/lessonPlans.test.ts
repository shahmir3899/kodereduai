import { buildPlanPayload, emptyPlanForm, planToForm, sortPlans, topicsFromText, validatePlan, type LessonPlan } from '../services/lessonPlans';

const section = { id: 30, label: '5-A', classObj: 5, isSession: true };
const master = { id: 5, label: '5', classObj: null, isSession: false };
const ok = { ...emptyPlanForm('2026-11-02', 8), title: 'Fractions', classOption: 30, subject: 9 };

describe('validation', () => {
  it('needs title, class, subject, teacher, date and a sane duration', () => {
    expect(validatePlan({ ...ok, title: ' ' })).toMatch(/title/);
    expect(validatePlan({ ...ok, title: 'x'.repeat(201) })).toMatch(/too long/);
    expect(validatePlan({ ...ok, classOption: null })).toMatch(/class/);
    expect(validatePlan({ ...ok, subject: null })).toMatch(/subject/);
    expect(validatePlan({ ...ok, teacher: null })).toMatch(/teacher/);
    expect(validatePlan({ ...ok, date: '' })).toMatch(/date/);
    expect(validatePlan({ ...ok, duration: '0' })).toMatch(/1 to 600/);
    expect(validatePlan({ ...ok, duration: '601' })).toMatch(/1 to 600/);
    expect(validatePlan({ ...ok, topics: Array.from({ length: 21 }, (_, i) => `t${i}`).join('\n') })).toMatch(/20/);
    expect(validatePlan(ok)).toBeNull();
  });
});

describe('payload', () => {
  it('sends the master class and the section for a section', () => {
    expect(buildPlanPayload({ ...ok, topics: 'Halves\n\n Quarters ', published: true }, section, { school: 42, academicYear: 3 })).toMatchObject({
      school: 42, academic_year: 3, class_obj: 5, session_class: 30, subject: 9, teacher: 8, lesson_date: '2026-11-02', duration_minutes: 40,
      custom_topics: ['Halves', 'Quarters'], status: 'PUBLISHED',
    });
  });
  it('sends a whole-class plan with no section, as a draft by default', () => {
    const p = buildPlanPayload({ ...ok, classOption: 5 }, master, { school: 42 });
    expect(p).toMatchObject({ class_obj: 5, session_class: null, status: 'DRAFT' });
    expect(p).not.toHaveProperty('academic_year');
  });
  it('caps topics at twenty, one per line', () => {
    expect(topicsFromText(Array.from({ length: 25 }, (_, i) => `t${i}`).join('\n'))).toHaveLength(20);
  });
});

describe('list helpers', () => {
  const plan = (over: Partial<LessonPlan>): LessonPlan => ({
    id: 1, title: 'A', lesson_date: '2026-11-01', duration_minutes: 40, status: 'DRAFT', class_obj: 5, session_class: 30, subject: 9, teacher: 8, ...over,
  });
  it('maps a saved plan back to its section or master class option', () => {
    expect(planToForm(plan({}), [section, master])).toMatchObject({ classOption: 30, published: false, duration: '40' });
    expect(planToForm(plan({ session_class: null }), [section, master]).classOption).toBe(5);
    expect(planToForm(plan({ status: 'PUBLISHED', custom_topics: ['a', 'b'] }), [section]).topics).toBe('a\nb');
  });
  it('lists the newest lesson first', () => {
    expect(sortPlans([plan({ id: 1, lesson_date: '2026-11-01' }), plan({ id: 2, lesson_date: '2026-11-05' })]).map((p) => p.id)).toEqual([2, 1]);
  });
});
