import { emptyPlanForm } from '../services/lessonPlans';
import {
  aiProblem, aiRequest, applyAiDraft, booksOf, buildBulkPlanPayload, bulkConflictText, bulkResultText, chapterIdsFor, emptyBulkPlanForm,
  rangeDays, toggleChapter, toggleId, topicSummary, validateAiDraft, validateBulkPlans,
} from '../services/lessonPlanTools';

const books = booksOf([
  { id: 1, title: 'Maths 5', chapters: [
    { id: 12, title: 'Fractions', chapter_number: 2, topics: [{ id: 101, title: 'Adding' }, { id: 102, title: 'Subtracting' }] },
    { id: 11, title: 'Numbers', chapter_number: 1, topics: [{ id: 100, title: 'Place value' }] },
    { id: 13, title: 'Empty', chapter_number: 3, topics: [] },
  ] },
  { id: 2, title: 'No topics', chapters: [{ id: 20, title: 'x', topics: [] }] },
]);

describe('topic picking', () => {
  it('keeps books and chapters that have topics, ordered by chapter number', () => {
    expect(books).toHaveLength(1);
    expect(books[0].chapters.map((c) => c.id)).toEqual([11, 12]);
    expect(booksOf(undefined)).toEqual([]);
    expect(booksOf({ results: [] })).toEqual([]);
  });
  it('ticks topics and whole chapters', () => {
    expect(toggleId([1], 2)).toEqual([1, 2]);
    expect(toggleId([1, 2], 2)).toEqual([1]);
    const fractions = books[0].chapters[1];
    expect(toggleChapter([], fractions)).toEqual([101, 102]);
    expect(toggleChapter([101], fractions)).toEqual([101, 102]);
    expect(toggleChapter([101, 102, 100], fractions)).toEqual([100]);
  });
  it('summarises what is chosen and finds the chapters', () => {
    expect(topicSummary(books, [100, 102])).toBe('Chapter 1: Numbers - Place value\nChapter 2: Fractions - Subtracting');
    expect(chapterIdsFor(books, [102])).toEqual([12]);
    expect(topicSummary(books, [])).toBe('');
  });
});

describe('AI draft', () => {
  const f = { ...emptyPlanForm('2026-11-02', 8), title: 'My title', topicIds: [101], duration: '40' };
  it('needs a topic and a date', () => {
    expect(validateAiDraft({ topicIds: [], date: '2026-11-02' })).toMatch(/topic/);
    expect(validateAiDraft({ topicIds: [1], date: '' })).toMatch(/date/);
    expect(validateAiDraft(f)).toBeNull();
  });
  it('asks with topics, their chapters, the date and the duration', () => {
    expect(aiRequest(f, books)).toEqual({ topic_ids: [101], chapter_ids: [12], subtopic_ids: [], lesson_date: '2026-11-02', duration_minutes: 40 });
    expect(aiRequest({ ...f, duration: '' }, books).duration_minutes).toBe(45);
  });
  it('fills the form from the draft and remembers the job', () => {
    const out = applyAiDraft(f, { success: true, title: ' Adding fractions ', objectives: 'o', description: 'd', teaching_methods: 'm', materials_needed: 'x', ai_job_id: 9 });
    expect(out).toMatchObject({ title: 'Adding fractions', objectives: 'o', description: 'd', methods: 'm', materials: 'x', aiJobId: 9 });
    expect(applyAiDraft(f, { success: true }).title).toBe('My title');
    expect(aiProblem({ success: false, error: 'AI is not configured.' })).toBe('AI is not configured.');
    expect(aiProblem({ success: true })).toBeNull();
  });
});

describe('bulk run', () => {
  it('counts days and limits the range', () => {
    expect(rangeDays('2026-11-02', '2026-11-02')).toBe(1);
    expect(rangeDays('2026-11-02', '2026-11-30')).toBe(29);
    const ok = { ...emptyBulkPlanForm('2026-11-02'), to: '2026-11-13' };
    expect(validateBulkPlans(ok)).toBeNull();
    expect(validateBulkPlans({ ...ok, to: '2026-11-01' })).toMatch(/before/);
    expect(validateBulkPlans({ ...ok, to: '2026-12-31' })).toMatch(/at most 35/);
    expect(validateBulkPlans({ ...ok, from: '' })).toMatch(/first and last/);
  });
  it('sends the plan fields plus the range and rules, not a single date or title', () => {
    const single = { school: 42, class_obj: 5, session_class: 30, subject: 9, teacher: 8, title: 'x', lesson_date: '2026-11-02', status: 'DRAFT', duration_minutes: 40, custom_topics: ['a'], planned_topic_ids: [101], content_mode: 'TOPICS' };
    const p = buildBulkPlanPayload(single, { from: '2026-11-02', to: '2026-11-13', skipSaturday: false, onConflict: 'error', titleTemplate: ' Maths ' });
    expect(p).toMatchObject({ school: 42, class_obj: 5, session_class: 30, subject: 9, teacher: 8, duration_minutes: 40, planned_topic_ids: [101], date_from: '2026-11-02', date_to: '2026-11-13', skip_saturday: false, on_conflict: 'error', title_template: 'Maths' });
    expect(p).not.toHaveProperty('lesson_date');
    expect(p).not.toHaveProperty('title');
    expect(p).not.toHaveProperty('status');
  });
  it('words the result and a conflict', () => {
    expect(bulkResultText({ created_count: 9, skipped_dates: ['2026-11-05'], skipped_off_days: [{}, {}] })).toBe('9 lesson plans created, 1 day already had one, 2 off days skipped.');
    expect(bulkResultText({ created_count: 1 })).toBe('1 lesson plan created.');
    expect(bulkResultText(undefined)).toBe('0 lesson plans created.');
    expect(bulkConflictText({ error: 'Dates taken.', conflict_dates: ['2026-11-03', '2026-11-04'] })).toBe('Dates taken. Days: 2026-11-03, 2026-11-04.');
    expect(bulkConflictText({ error: 'x' })).toBeNull();
  });
});
