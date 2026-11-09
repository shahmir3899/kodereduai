import { activePreset, groupPlans, planBodySections, planStats, presetRange } from '../services/lessonPlanView';
import type { LessonPlan } from '../services/lessonPlans';

const mk = (o: Partial<LessonPlan>): LessonPlan => ({
  id: 1, title: 't', lesson_date: '2026-11-02', duration_minutes: 40, status: 'DRAFT', class_obj: 5, subject: 9,
  teacher: 3, class_name: '5-A', subject_name: 'Math', teacher_name: 'Sara', ...o,
});

describe('presetRange', () => {
  const today = new Date(2026, 10, 7); // Sat 7 Nov 2026
  it('builds local ranges', () => {
    expect(presetRange('today', today)).toEqual({ from: '2026-11-07', to: '2026-11-07' });
    expect(presetRange('week', today)).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(presetRange('month', today)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(presetRange('last_month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('next_month', new Date(2026, 11, 15))).toEqual({ from: '2027-01-01', to: '2027-01-31' });
  });
  it('finds the matching preset', () => {
    expect(activePreset('2026-11-01', '2026-11-30', today)).toBe('month');
    expect(activePreset('2026-11-01', '2026-11-15', today)).toBeNull();
  });
});

describe('planStats and groupPlans', () => {
  const plans = [
    mk({ id: 1, status: 'PUBLISHED' }),
    mk({ id: 2, class_obj: 6, class_name: '6-A', lesson_date: '2026-11-01' }),
    mk({ id: 3, subject: 10, subject_name: 'Art', teacher: 4 }),
  ];
  it('counts', () => {
    expect(planStats(plans)).toEqual({ total: 3, published: 1, draft: 2, teachers: 2, subjects: 2, classes: 2 });
  });
  it('groups subject then class, dated', () => {
    const g = groupPlans(plans, 'subject');
    expect(g.map((s) => [s.label, s.count])).toEqual([['Art', 1], ['Math', 2]]);
    const math = g[1];
    expect(math.children.map((c) => c.label)).toEqual(['5-A', '6-A']);
    expect(math.published).toBe(1);
  });
  it('groups class then subject', () => {
    const g = groupPlans(plans, 'class');
    expect(g.map((s) => s.label)).toEqual(['5-A', '6-A']);
    expect(g[0].children.map((c) => c.label)).toEqual(['Art', 'Math']);
  });
});

describe('planBodySections', () => {
  it('shows description only when there is no display text', () => {
    expect(planBodySections(mk({ display_text: 'Body', description: 'Old' })).map((s) => s[1])).toEqual(['Body']);
    expect(planBodySections(mk({ description: 'Old', custom_topics: ['A'] }))).toEqual([['Lesson', 'Old'], ['Topics', 'A']]);
  });
});
