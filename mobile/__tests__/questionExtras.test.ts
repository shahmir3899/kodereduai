import {
  aiLabel, aiStatus, autoPaperTitle, bloomMix, bulkDeleteMessage, bulkDeleteResult, canCreateTag, coverageView, docxFileName, examOptionLabel,
  filterTags, hitContext, lessonLine, newTagPayload, questionListParams, sameIds, selectedAll, semanticHitsOf, semanticParams, sloText,
  toggleAll, toggleId, topicsOfLessons, verifyPayload, type CoverageStats,
} from '../services/questionExtras';

describe('question list', () => {
  it('sends only the filters the server applies', () => {
    expect(questionListParams({}, 1)).toEqual({ page: 1, page_size: 20 });
    expect(questionListParams({ search: 'x', subject: 3, type: 'MCQ', difficulty: 'HARD', bloom: 'apply', tagId: 9 }, 2)).toEqual({
      page: 2, page_size: 20, search: 'x', subject: 3, question_type: 'MCQ', difficulty: 'HARD', bloom_level: 'apply', tag_id: 9,
    });
  });
  it('builds the semantic search like the web', () => {
    expect(semanticParams('how to count', 5, 7)).toEqual({ q: 'how to count', limit: 50, class_id: 5, subject: 7 });
    expect(semanticParams('x', null, null)).toEqual({ q: 'x', limit: 50 });
  });
  it('reads hits from any answer shape', () => {
    expect(semanticHitsOf([{ id: 1, question_text: 'a', question_type: 'MCQ' }])).toHaveLength(1);
    expect(semanticHitsOf({ results: [{ id: 2 }] })).toHaveLength(1);
    expect(semanticHitsOf({ questions: [{ id: 3 }] })).toHaveLength(1);
    expect(semanticHitsOf(null)).toEqual([]);
    expect(hitContext({ id: 1, question_text: '', question_type: '', book_title: 'B', topic_title: 'T' })).toBe('B > T');
  });
});

describe('AI questions', () => {
  it('tells verified from unverified', () => {
    expect(aiStatus({})).toBeNull();
    expect(aiStatus({ is_ai_generated: true })).toBe('unverified');
    expect(aiStatus({ is_ai_generated: true, verified_by: 4 })).toBe('verified');
    expect(aiLabel('unverified')).toBe('AI · Unverified');
    expect(aiLabel(null)).toBe('');
  });
  it('builds the verify payload', () => {
    expect(verifyPayload(7, new Date('2026-11-02T10:00:00Z'))).toEqual({ verified_by: 7, verified_at: '2026-11-02T10:00:00.000Z' });
  });
});

describe('tags', () => {
  const tags = [{ id: 1, name: 'Fractions' }, { id: 2, name: 'Decimals' }];
  it('toggles, filters and creates', () => {
    expect(toggleId([1], 2)).toEqual([1, 2]);
    expect(toggleId([1, 2], 1)).toEqual([2]);
    expect(filterTags(tags, 'dec')).toEqual([tags[1]]);
    expect(filterTags(tags, ' ')).toEqual(tags);
    expect(canCreateTag(tags, 'fractions')).toBe(false);
    expect(canCreateTag(tags, 'Geometry')).toBe(true);
    expect(canCreateTag(tags, ' ')).toBe(false);
    expect(newTagPayload(' Geo ', 5)).toEqual({ name: 'Geo', tag_type: 'keyword', subject: 5 });
  });
});

describe('several papers', () => {
  it('selects the page and clears it again', () => {
    expect(selectedAll([], [])).toBe(false);
    expect(toggleAll([1, 2], [])).toEqual([1, 2]);
    expect(toggleAll([1, 2], [1, 2, 9])).toEqual([9]);
    expect(toggleAll([1, 2], [1])).toEqual([1, 2]);
  });
  it('words the delete and names the Word file', () => {
    expect(bulkDeleteMessage(1)).toBe('Delete 1 paper? This cannot be undone.');
    expect(bulkDeleteMessage(3)).toBe('Delete 3 papers? This cannot be undone.');
    expect(bulkDeleteResult({ deleted: [3, 4], skipped: [] })).toBe('2 papers deleted.');
    expect(bulkDeleteResult({ deleted: [3], skipped: [{ id: 9, reason: 'Not found.' }, { id: 8, reason: 'Not found.' }] })).toBe('1 paper deleted. 2 skipped: Not found.');
    expect(bulkDeleteResult(null)).toBe('0 papers deleted.');
    expect(docxFileName('Mid-Term: Maths!')).toBe('Mid_Term_Maths.docx');
    expect(docxFileName('')).toBe('Paper.docx');
  });
});

describe('exam and title', () => {
  it('labels an exam safely', () => {
    expect(examOptionLabel({ id: 4, name: 'Mid-Term', exam_type_name: 'Term exam', start_date: '2026-11-03' })).toBe('Mid-Term (Term exam) - 3 Nov 2026');
    expect(examOptionLabel({ id: 4, name: 'Final', exam_type_name: 'Final' })).toBe('Final');
    expect(examOptionLabel({ id: 9 })).toBe('Exam #9');
    expect(examOptionLabel({ id: 9, name: 'X', start_date: 'junk' })).toBe('X');
  });
  it('joins the parts of the automatic title', () => {
    expect(autoPaperTitle('Mid-Term', 'Class 5', 'Maths')).toBe('Mid-Term - Class 5 - Maths');
    expect(autoPaperTitle('', 'Class 5', 'Maths')).toBe('Class 5 - Maths');
  });
});

describe('coverage', () => {
  const stats: CoverageStats = {
    linked_lesson_plans: [{ id: 3 }, { id: 4 }],
    planned_topics_coverage: [
      { topic_id: 1, is_covered: true, slos: [{ id: 10, code: 'M1', statement: 'Count' }, { id: 11 }] },
      { topic_id: 2, is_covered: false, slos: [{ id: 11 }, { id: 12, code: 'M3', statement: 'Add' }] },
    ],
  };
  it('counts objectives once and splits covered from not covered', () => {
    const v = coverageView(stats);
    expect(v.total).toBe(3);
    expect(v.covered.map((s) => s.id)).toEqual([10, 11]);
    expect(v.uncovered.map((s) => s.id)).toEqual([12]);
    expect(v.percent).toBe(67);
    expect(v.linkedIds).toEqual([3, 4]);
    expect(sloText({ id: 10, code: 'M1', statement: 'Count' })).toBe('M1 Count');
    expect(sloText({ id: 5 })).toBe('SLO-5');
  });
  it('copes with nothing linked', () => {
    expect(coverageView(null)).toMatchObject({ total: 0, percent: 0, linkedIds: [] });
    expect(coverageView({ slo_coverage_count: 2 }).coveredCount).toBe(2);
  });
  it('spreads the questions over thinking levels', () => {
    const m = bloomMix([{ bloom_level: 'remember' }, { bloom_level: 'Understand' }, { bloom_level: 'apply' }, { bloom_level: null }, { bloom_level: 'odd' }]);
    expect(m.total).toBe(5);
    expect(m.counts).toMatchObject({ remember: 1, understand: 1, apply: 1, unclassified: 2 });
    expect(m.percent.remember).toBe(20);
    expect(m.surfaceHeavy).toBe(false);
    expect(bloomMix([{ bloom_level: 'remember' }, { bloom_level: 'remember' }, { bloom_level: 'apply' }]).surfaceHeavy).toBe(false);
    expect(bloomMix([{ bloom_level: 'remember' }, { bloom_level: 'remember' }, { bloom_level: 'understand' }, { bloom_level: 'apply' }]).surfaceHeavy).toBe(true);
    expect(bloomMix([]).total).toBe(0);
  });
});

describe('lesson plans', () => {
  const lessons = [
    { id: 1, title: 'A', lesson_date: '2026-11-01', planned_topics: [{ id: 5, title: 'T5' }, { id: 6, title: 'T6' }] },
    { id: 2, title: 'B', planned_topics: [{ id: 6, title: 'T6' }] },
    { id: 3, title: 'C', planned_topics: [{ id: 9 }] },
  ];
  it('collects each topic once', () => {
    expect(topicsOfLessons(lessons, [1, 2]).map((t) => t.id)).toEqual([5, 6]);
    expect(topicsOfLessons(lessons, [])).toEqual([]);
    expect(lessonLine(lessons[0])).toBe('2026-11-01 • 2 topic(s)');
    expect(lessonLine(lessons[1])).toBe('No date • 1 topic(s)');
  });
  it('compares chosen sets', () => {
    expect(sameIds([1, 2], [2, 1])).toBe(true);
    expect(sameIds([1], [1, 2])).toBe(false);
  });
});
