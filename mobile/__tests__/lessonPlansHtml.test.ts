import {
  EXPORT_MAX_PLANS, exportCountProblem, exportRangeProblem, formatLessonDate, groupPlans, isMinimalPlan, lessonPlansFileName,
  renderLessonPlansHtml, sortByDate, splitRuns, topicCell, type ExportPlan,
} from '../services/lessonPlansHtml';

const plan = (over: Partial<ExportPlan> = {}): ExportPlan => ({
  id: 1, title: 'Fractions', lesson_date: '2026-11-03', duration_minutes: 40, status: 'DRAFT',
  class_obj: 5, class_name: 'Grade 5 - A', subject: 2, subject_name: 'Maths', teacher_name: 'Mr Khan', ...over,
});
const detailed = (over: Partial<ExportPlan> = {}) => plan({ description: 'Add halves', ...over });

describe('range and count checks', () => {
  it('needs both dates, in order', () => {
    expect(exportRangeProblem('2026-11-01', '2026-11-30')).toBeNull();
    expect(exportRangeProblem('2026-11-01', '2026-11-01')).toBeNull();
    expect(exportRangeProblem('', '2026-11-30')).toBe('Choose both lesson dates to download the PDF.');
    expect(exportRangeProblem('2026-11-01', 'x')).toBe('Choose both lesson dates to download the PDF.');
    expect(exportRangeProblem('2026-12-01', '2026-11-30')).toBe('From must not be after To.');
  });

  it('refuses an empty or oversized export', () => {
    expect(exportCountProblem(0)).toBe('No lesson plans match these filters.');
    expect(exportCountProblem(1)).toBeNull();
    expect(exportCountProblem(EXPORT_MAX_PLANS)).toBeNull();
    expect(exportCountProblem(EXPORT_MAX_PLANS + 1)).toMatch(/Narrow the dates/);
  });
});

describe('grouping', () => {
  it('detects a plan with no detail text, treating lists and objects as text', () => {
    expect(isMinimalPlan(plan())).toBe(true);
    expect(isMinimalPlan(plan({ description: '  ' }))).toBe(true);
    expect(isMinimalPlan(plan({ objectives: ['a'] }))).toBe(false);
    expect(isMinimalPlan(plan({ objectives_text: '- x' }))).toBe(false);
    expect(isMinimalPlan(plan({ materials_needed: 'chart' }))).toBe(false);
  });

  it('groups by class then subject, alphabetically, keeping date order inside', () => {
    const plans = [
      plan({ id: 1, class_obj: 6, class_name: 'Grade 6', subject: 2, subject_name: 'Maths' }),
      plan({ id: 2, class_obj: 5, class_name: 'Grade 5 - A', subject: 3, subject_name: 'Urdu' }),
      plan({ id: 3, class_obj: 5, class_name: 'Grade 5 - A', subject: 2, subject_name: 'Maths', lesson_date: '2026-11-05' }),
      plan({ id: 4, class_obj: 5, class_name: 'Grade 5 - A', subject: 2, subject_name: 'Maths', lesson_date: '2026-11-04' }),
    ];
    const groups = groupPlans(plans);
    expect(groups.map((g) => `${g.className}/${g.subjectName}`)).toEqual(['Grade 5 - A/Maths', 'Grade 5 - A/Urdu', 'Grade 6/Maths']);
    expect(groups[0].plans.map((p) => p.id)).toEqual([3, 4]);
  });

  it('splits a group into runs of plain and detailed plans in order', () => {
    const runs = splitRuns([plan({ id: 1 }), plan({ id: 2 }), detailed({ id: 3 }), plan({ id: 4 })]);
    expect(runs.map((r) => [r.minimal, r.plans.map((p) => p.id)])).toEqual([[true, [1, 2]], [false, [3]], [true, [4]]]);
  });

  it('sorts oldest first', () => {
    const sorted = sortByDate([plan({ id: 2, lesson_date: '2026-11-05' }), plan({ id: 1, lesson_date: '2026-11-03' }), plan({ id: 3, lesson_date: '2026-11-03' })]);
    expect(sorted.map((p) => p.id)).toEqual([1, 3, 2]);
  });
});

describe('table cells and file names', () => {
  it('adds custom topics the title does not name', () => {
    expect(topicCell(plan({ title: 'Fractions' }))).toBe('Fractions');
    expect(topicCell(plan({ title: 'Fractions', custom_topics: ['Halves', ' '] }))).toBe('Fractions\nHalves');
    expect(topicCell(plan({ title: 'Fractions: Halves', custom_topics: ['Halves'] }))).toBe('Fractions: Halves');
    expect(topicCell(plan({ title: ' ', display_text: 'Book > Chapter' }))).toBe('Book > Chapter');
    expect(topicCell(plan({ title: '' }))).toBe('Untitled');
  });

  it('formats dates the way the web export does', () => {
    expect(formatLessonDate('2026-11-03')).toBe('3 Nov 2026');
    expect(formatLessonDate(null)).toBe('—');
    expect(formatLessonDate('not-a-date')).toBe('not-a-date');
  });

  it('names the file after the class and subject, or says there are several', () => {
    expect(lessonPlansFileName([plan()], '2026-11-01', '2026-11-30')).toBe('lesson-plans_Grade-5-A_Maths_2026-11-01_2026-11-30.pdf');
    const mixed = [plan(), plan({ id: 2, class_name: 'Grade 6', subject_name: 'Urdu' })];
    expect(lessonPlansFileName(mixed, '2026-11-01', '2026-11-30')).toBe('lesson-plans_multiple-classes_multiple-subjects_2026-11-01_2026-11-30.pdf');
    expect(lessonPlansFileName([], '2026-11-01', '2026-11-30')).toBe('lesson-plans_all-classes_all-subjects_2026-11-01_2026-11-30.pdf');
    expect(lessonPlansFileName([plan({ class_name: '!!!' })], 'a', 'b')).toContain('_unknown_');
  });
});

describe('the page', () => {
  const html = (plans: ExportPlan[], over: Record<string, unknown> = {}) =>
    renderLessonPlansHtml({ plans, from: '2026-11-01', to: '2026-11-30', yearLabel: '2026-27', school: { name: 'Demo <School>', logo: 'https://x.test/l.png' }, generatedAt: '3/11/2026', ...over });

  it('has the cover: school, title bar, year, date range and count', () => {
    const out = html([plan()]);
    expect(out).toContain('Demo &lt;School&gt;');
    expect(out).toContain('Lesson plans</div>');
    expect(out).toContain('Academic year: 2026-27');
    expect(out).toContain('Lesson dates: 1 Nov 2026 to 30 Nov 2026');
    expect(out).toContain('Plans included: 1');
    expect(out).toContain('src="https://x.test/l.png"');
    expect(out).toContain('Generated: 3/11/2026');
  });

  it('leaves out the logo, school and year when there are none', () => {
    const out = html([plan()], { school: null, yearLabel: null });
    expect(out).not.toContain('<img');
    expect(out).not.toContain('class="school"');
    expect(out).not.toContain('Academic year');
  });

  it('shows the teacher once under the heading when it is the same for the group, else a column', () => {
    const same = html([plan({ id: 1 }), plan({ id: 2 })]);
    expect(same).toContain('Teacher: Mr Khan');
    expect(same).not.toContain('<th>Teacher</th>');
    const mixed = html([plan({ id: 1 }), plan({ id: 2, teacher_name: 'Ms Ali' })]);
    expect(mixed).toContain('<th>Teacher</th>');
    expect(mixed).not.toContain('class="teacher"');
  });

  it('draws plain plans as table rows and detailed plans as cards with their sections', () => {
    const out = html([plan({ id: 1 }), detailed({ id: 2, objectives_text: '- Add halves', planned_topics: [{ id: 1, title: 'Fractions', chapter: 4 }], custom_topics: ['Quarters'], ai_generated: true })]);
    expect(out).toContain('<table class="grid">');
    expect(out).toContain('class="card"');
    expect(out).toContain('<h4>Description</h4>');
    expect(out).toContain('<h4>Objectives</h4>');
    expect(out).toContain('- Add halves');
    expect(out).toContain('• Fractions (Ch. 4)');
    expect(out).toContain('<h4>Custom topics</h4>');
    expect(out).toContain('AI-generated');
    expect(out).toContain('<div class="txt" dir="auto">—</div>'); // an empty section reads as a dash
  });

  it('escapes every piece of plan text', () => {
    const out = html([detailed({ title: '<script>x</script>', description: 'a & <b>', teacher_name: '"Q"' })]);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('a &amp; &lt;b&gt;');
    expect(out).toContain('&quot;Q&quot;');
  });

  it('lets the web view shape Urdu text by marking cells for automatic direction', () => {
    expect(html([plan({ title: 'کسر' })])).toContain('dir="auto"');
  });
});
