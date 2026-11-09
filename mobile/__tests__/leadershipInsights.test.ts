import { departureLine, hasCurriculumData, insightGates, lessonPlanPreview } from '../services/leadershipInsights';

describe('insightGates', () => {
  it('shows the roster block for students or admissions, curriculum for lms or examinations', () => {
    const on = (set: string[]) => (k: string) => set.includes(k);
    expect(insightGates(on(['students']) as never)).toEqual({ roster: true, curriculum: false });
    expect(insightGates(on(['admissions', 'lms']) as never)).toEqual({ roster: true, curriculum: true });
    expect(insightGates(on(['examinations']) as never)).toEqual({ roster: false, curriculum: true });
    expect(insightGates(on([]) as never)).toEqual({ roster: false, curriculum: false });
  });
});

describe('departureLine', () => {
  it('lists non-zero statuses with spaces for underscores', () => {
    expect(departureLine({ total: 4, by_status: { WITHDRAWN: 2, TRANSFERRED: 0, LEFT_SCHOOL: 2 } })).toBe('withdrawn 2 · left school 2');
    expect(departureLine({ total: 0, by_status: {} })).toBe('');
    expect(departureLine(null)).toBe('');
  });
});

describe('lessonPlanPreview', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ teacher_id: i, class_id: i, teacher_name: `T${i}`, class_name: 'C', previous_month: 0, current_month: 1, next_month: 2 }));
  it('shows the first rows and the full count', () => {
    const p = lessonPlanPreview({ lesson_plans: { by_teacher_class: rows } });
    expect(p.rows).toHaveLength(8);
    expect(p.total).toBe(12);
    expect(lessonPlanPreview(null)).toEqual({ rows: [], total: 0 });
  });
});

describe('hasCurriculumData', () => {
  it('is false for an empty school', () => {
    expect(hasCurriculumData({})).toBe(false);
    expect(hasCurriculumData({ question_bank: { total: 3 } })).toBe(true);
    expect(hasCurriculumData({ lms_books_by_class: [{ class_id: 1, class_name: 'A', book_count: 2 }] })).toBe(true);
  });
});

describe('lessonPlanClassRows', () => {
  const sub = (id: number, cur: number, prev = 0) => ({ subject_id: id, subject_name: `S${id}`, previous_month: prev, current_month: cur, next_month: 0, draft_current_month: 0 });
  const teacher = (subjects: ReturnType<typeof sub>[]) => ({ teacher_id: 1, teacher_name: 'T', previous_month: 0, current_month: 0, next_month: 0, draft_current_month: 0, subjects });
  const data = { lesson_plans: { by_class: [
    { class_id: 1, class_name: '5-A', previous_month: 0, current_month: 3, next_month: 0, teachers: [teacher([sub(1, 3)])] },
    { class_id: 2, class_name: '6-A', previous_month: 4, current_month: 0, next_month: 0, teachers: [teacher([sub(2, 0, 4)])] },
    { class_id: 3, class_name: '7-A', previous_month: 0, current_month: 0, next_month: 0, teachers: [teacher([])] },
  ] } };
  it('keeps classes with plans or with a subject gone quiet this month', () => {
    const { lessonPlanClassRows } = require('../services/leadershipInsights');
    expect(lessonPlanClassRows(data, 'current_month').map((c: { class_id: number }) => c.class_id)).toEqual([1, 2]);
    expect(lessonPlanClassRows(data, 'previous_month').map((c: { class_id: number }) => c.class_id)).toEqual([1, 2]);
  });
});

describe('teachersBehind', () => {
  const t = (id: number, cur: number, prev: number, drafts = 0) => ({
    teacher_id: id, teacher_name: `T${id}`, previous_month: prev, current_month: cur, next_month: 0, draft_current_month: drafts, subjects: [],
  });
  it('adds a teacher across classes and ranks the biggest drop first', () => {
    const { teachersBehind } = require('../services/leadershipInsights');
    const data = { lesson_plans: { by_class: [
      { class_id: 1, class_name: 'A', previous_month: 0, current_month: 0, next_month: 0, teachers: [t(1, 2, 6), t(2, 5, 5, 0), t(3, 4, 4, 2)] },
      { class_id: 2, class_name: 'B', previous_month: 0, current_month: 0, next_month: 0, teachers: [t(1, 1, 4)] },
    ] } };
    const rows = teachersBehind(data);
    expect(rows.map((r: { teacher_id: number }) => r.teacher_id)).toEqual([1, 3]);
    expect(rows[0]).toMatchObject({ current: 3, previous: 10 });
    expect(rows[1].drafts).toBe(2);
  });
});
