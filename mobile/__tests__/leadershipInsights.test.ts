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
