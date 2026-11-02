import {
  blockToForm, blockTypeLabel, bookToEditForm, buildBlockPayload, buildBookEditPayload, buildSubtopicPayload, buildTocFromLabeledText,
  confidenceText, emptyBlockForm, outlineFromParse, outlineFromSuggestion, parseLabeledLines, progressForBook, progressPercent,
  revisionLine, searchHitsOf, sortBlocks, subtopicToForm, validateBlock, validateBookEdit, validateSubtopic,
  type ContentBlock,
} from '../services/curriculumContent';

describe('book edit', () => {
  it('loads, validates and builds the payload like the web', () => {
    const f = bookToEditForm({ id: 1, title: ' Maths ', author: null as unknown as string, language: '' });
    expect(f).toEqual({ title: ' Maths ', author: '', publisher: '', edition: '', language: 'en', description: '' });
    expect(validateBookEdit({ ...f, title: ' ' })).toMatch(/title/);
    expect(buildBookEditPayload(f, 7)).toEqual({ title: 'Maths', author: '', publisher: '', edition: '', language: 'en', description: '', school: 7 });
    expect(buildBookEditPayload(f, undefined)).not.toHaveProperty('school');
  });
});

describe('labelled contents text', () => {
  it('reads CHAPTER / TOPIC / EXERCISE lines', () => {
    const t = 'CHAPTER: Numbers\nTOPIC: Counting\nexercise: Practice 1\nCHAPTER: Shapes\nTOPIC: Circles';
    expect(parseLabeledLines(t).map((l) => l.label)).toEqual(['chapter', 'topic', 'exercise', 'chapter', 'topic']);
    const r = buildTocFromLabeledText(t);
    expect(r.hasLabels).toBe(true);
    expect(r.chapters.map((c) => [c.title, c.topics.map((x) => [x.title, x.content_kind])])).toEqual([
      ['Numbers', [['Counting', 'general'], ['Practice 1', 'exercise']]], ['Shapes', [['Circles', 'general']]],
    ]);
  });
  it('warns when a topic comes first and ignores plain text without labels', () => {
    const r = buildTocFromLabeledText('TOPIC: Orphan');
    expect(r.chapters[0].title).toBe('Untitled Chapter');
    expect(r.warnings[0]).toMatch(/Line 1/);
    expect(buildTocFromLabeledText('1. One\n1.1 Two').hasLabels).toBe(false);
  });
  it('treats the first plain line as a chapter and later ones as topics', () => {
    const r = buildTocFromLabeledText('NOTE: hi\nA\nB');
    expect(r.hasLabels).toBe(true);
    expect(r.chapters.map((c) => c.title)).toEqual(['Untitled Chapter']);
  });
});

describe('outline answers', () => {
  it('reads the parse answer', () => {
    const o = outlineFromParse({ chapters: [{ title: 'A', topics: [{ title: 'a1' }, {}] }], warnings: ['w'] });
    expect(o.chapters[0].topics.map((t) => t.title)).toEqual(['a1', '']);
    expect(o).toMatchObject({ warnings: ['w'], source: 'rule_based', confidence: null });
    expect(outlineFromParse(null).chapters).toEqual([]);
  });
  it('prefers chapters from the AI answer and keeps the confidence', () => {
    const o = outlineFromSuggestion({ chapters: [{ title: 'Ch', topics: [{ title: 'T' }] }], confidence: 0.82, source: 'ai' });
    expect(o.chapters[0]).toMatchObject({ title: 'Ch' });
    expect(o).toMatchObject({ confidence: 0.82, source: 'ai' });
    expect(confidenceText(0.82)).toBe('82% sure');
    expect(confidenceText(null)).toBe('');
  });
  it('groups flat suggestions under their chapters', () => {
    const o = outlineFromSuggestion({ suggestions: [
      { kind: 'chapter', title: 'Ch1' }, { kind: 'topic', title: 'T1', chapter_title: 'Ch1' }, { kind: 'topic', title: 'T2', chapter_title: 'Ch1' },
      { kind: 'chapter', title: 'Ch2' }, { kind: 'topic', title: ' ' },
    ] });
    expect(o.chapters.map((c) => [c.title, c.topics.map((t) => t.title)])).toEqual([['Ch1', ['T1', 'T2']], ['Ch2', []]]);
    expect(o.confidence).toBe(0.7);
  });
});

describe('sub-topic form', () => {
  it('checks minutes and builds the payload', () => {
    expect(validateSubtopic({ contentText: '', minutes: '1.5' })).toMatch(/whole/);
    expect(validateSubtopic({ contentText: '', minutes: '' })).toBeNull();
    expect(buildSubtopicPayload({ contentText: ' hi ', minutes: '' })).toEqual({ content_text: 'hi', estimated_minutes: null });
    expect(buildSubtopicPayload({ contentText: '', minutes: '20' }).estimated_minutes).toBe(20);
    expect(subtopicToForm({ id: 1, title: 'x', estimated_minutes: 5, content_text: 'a' })).toEqual({ contentText: 'a', minutes: '5' });
  });
});

describe('content blocks', () => {
  const block = (o: Partial<ContentBlock> = {}): ContentBlock => ({ id: 1, block_type: 'text', content_text: 'x', sequence_order: 2, ...o });
  it('puts a new block after the last one', () => {
    expect(emptyBlockForm([]).sequence).toBe('1');
    expect(emptyBlockForm([block({ sequence_order: 4 }), block({ id: 2, sequence_order: 2 })]).sequence).toBe('5');
  });
  it('validates text, JSON and numbers', () => {
    const f = { ...emptyBlockForm([]), text: 'Body' };
    expect(validateBlock({ ...f, text: ' ' })).toMatch(/required/);
    expect(validateBlock({ ...f, rich: '{bad' })).toMatch(/JSON/);
    expect(validateBlock({ ...f, minutes: 'x' })).toMatch(/whole/);
    expect(validateBlock({ ...f, rich: '{"a":1}' })).toBeNull();
  });
  it('builds the payload and round-trips a block', () => {
    const f = { type: 'definition', text: ' Def ', rich: '{"a":1}', sequence: '3', difficulty: '2', minutes: '' };
    expect(buildBlockPayload(f, 9)).toEqual({ topic: 9, block_type: 'definition', content_text: 'Def', content_rich: { a: 1 }, sequence_order: 3, difficulty_level: 2, estimated_minutes: null });
    expect(buildBlockPayload({ ...f, rich: '', sequence: 'x', difficulty: '' }, 9)).toMatchObject({ content_rich: null, sequence_order: 0, difficulty_level: null });
    const back = blockToForm(block({ block_type: 'formula', content_rich: { z: 1 }, difficulty_level: 3, estimated_minutes: 10 }));
    expect(back).toMatchObject({ type: 'formula', difficulty: '3', minutes: '10', sequence: '2' });
    expect(JSON.parse(back.rich)).toEqual({ z: 1 });
  });
  it('orders blocks and names types', () => {
    expect(sortBlocks([block({ id: 2, sequence_order: 5 }), block({ id: 1, sequence_order: 1 })]).map((b) => b.id)).toEqual([1, 2]);
    expect(blockTypeLabel('diagram_desc')).toBe('Diagram description');
    expect(blockTypeLabel('custom_kind')).toBe('Custom Kind');
    expect(blockTypeLabel(null)).toBe('Text');
  });
});

describe('revisions, search and progress', () => {
  it('describes a revision', () => {
    expect(revisionLine({ id: 1, content_text: 'x', changed_at: '2026-11-02T10:30:00Z', changed_by_name: 'ali', revision_note: 'typo' })).toBe('2026-11-02 10:30  ·  ali  ·  typo');
    expect(revisionLine({ id: 2, content_text: 'x' })).toBe('');
  });
  it('reads search answers', () => {
    expect(searchHitsOf([{ id: 1, block_type: 't', content_text: 'a' }])).toHaveLength(1);
    expect(searchHitsOf({ results: [{ id: 2, block_type: 't', content_text: 'b' }] })).toHaveLength(1);
    expect(searchHitsOf(null)).toEqual([]);
  });
  it('computes progress', () => {
    expect(progressPercent({ total_topics: 8, covered_topics: 2 })).toBe(25);
    expect(progressPercent({ total_topics: 0, covered_topics: 0 })).toBe(0);
    expect(progressPercent(null)).toBe(0);
    const p = { total_topics: 10, covered_topics: 4, books: [{ book_id: 3, total_topics: 10, covered_topics: 4, percentage: 40 }] };
    expect(progressForBook(p, 3)?.percentage).toBe(40);
    expect(progressForBook(p, 9)).toBeNull();
    expect(progressForBook(null, 3)).toBeNull();
  });
});
