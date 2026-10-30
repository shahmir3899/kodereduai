import {
  applyPayload, applyResultText, buildBookPayload, buildChapterPayload, buildTopicPayload, emptyBookForm, emptyChapterForm,
  emptyTopicForm, nextNumber, removeTocChapter, removeTocTopic, renameTocChapter, tocCounts, tocImageProblem, tocJobState,
  tocPollDelay, validateBook, validateChapter, validateTopic, type TocChapter,
} from '../services/curriculum';

describe('book', () => {
  const ok = { ...emptyBookForm(), title: 'Maths 5', classObj: 5, subject: 9 };
  it('needs a title, a class and a subject', () => {
    expect(validateBook({ ...ok, title: ' ' })).toMatch(/title/);
    expect(validateBook({ ...ok, classObj: null })).toMatch(/class/);
    expect(validateBook({ ...ok, subject: null })).toMatch(/subject/);
    expect(validateBook(ok)).toBeNull();
  });
  it('builds the payload with the school and trimmed text', () => {
    expect(buildBookPayload({ ...ok, author: ' A. Khan ' }, 42)).toEqual({
      school: 42, class_obj: 5, subject: 9, title: 'Maths 5', author: 'A. Khan', publisher: '', edition: '', language: 'en', is_active: true,
    });
  });
});

describe('chapter and topic', () => {
  it('validates title, number and page range', () => {
    expect(validateChapter({ ...emptyChapterForm(1), title: '' })).toMatch(/title/);
    expect(validateChapter({ ...emptyChapterForm(0), title: 'A' })).toMatch(/number/);
    expect(validateChapter({ ...emptyChapterForm(1), title: 'A', pageStart: '10', pageEnd: '5' })).toMatch(/last page/);
    expect(validateChapter({ ...emptyChapterForm(1), title: 'A', pageStart: 'x' })).toMatch(/whole numbers/);
    expect(validateChapter({ ...emptyChapterForm(1), title: 'A', pageStart: '1', pageEnd: '12' })).toBeNull();
    expect(validateTopic({ ...emptyTopicForm(1), title: '' })).toMatch(/title/);
    expect(validateTopic({ ...emptyTopicForm(2), title: 'T' })).toBeNull();
  });
  it('builds payloads, sending the parent only when creating', () => {
    expect(buildChapterPayload({ ...emptyChapterForm(3), title: ' Fractions ', pageStart: '20' }, 7)).toEqual({
      book: 7, title: 'Fractions', chapter_number: 3, page_start: 20, page_end: null,
    });
    expect(buildChapterPayload(emptyChapterForm(1), null)).not.toHaveProperty('book');
    expect(buildTopicPayload({ ...emptyTopicForm(2), title: 'Adding', kind: 'exercise' }, 11)).toEqual({
      chapter: 11, title: 'Adding', topic_number: 2, page_start: null, page_end: null, content_kind: 'exercise',
    });
  });
  it('suggests the next free number', () => {
    expect(nextNumber([1, 2, '3'])).toBe(4);
    expect(nextNumber([])).toBe(1);
    expect(nextNumber([undefined, null])).toBe(1);
  });
});

describe('table of contents scan', () => {
  it('reads the job status', () => {
    expect(tocJobState('QUEUED')).toBe('working');
    expect(tocJobState('PROCESSING')).toBe('working');
    expect(tocJobState(undefined)).toBe('working');
    expect(tocJobState('SUCCEEDED')).toBe('done');
    expect(tocJobState('FAILED')).toBe('failed');
    expect(tocJobState('TIMED_OUT')).toBe('failed');
  });
  it('polls fast, then slower', () => {
    expect(tocPollDelay(0)).toBe(1500);
    expect(tocPollDelay(10)).toBe(3000);
  });
  it('checks the photo before upload', () => {
    expect(tocImageProblem('image/heic', 1000)).toMatch(/JPEG/);
    expect(tocImageProblem('image/jpeg', 11 * 1024 * 1024)).toMatch(/too large/);
    expect(tocImageProblem('image/jpeg', 2 * 1024 * 1024)).toBeNull();
    expect(tocImageProblem(undefined, undefined)).toBeNull();
  });
  const chapters: TocChapter[] = [
    { title: 'One', topics: [{ title: 'a' }, { title: 'b' }] },
    { title: 'Two', topics: [] },
  ];
  it('edits the preview without mutating it', () => {
    expect(tocCounts(chapters)).toEqual({ chapters: 2, topics: 2 });
    expect(removeTocChapter(chapters, 0).map((c) => c.title)).toEqual(['Two']);
    expect(removeTocTopic(chapters, 0, 1)[0].topics.map((t) => t.title)).toEqual(['a']);
    expect(renameTocChapter(chapters, 1, 'Two B')[1].title).toBe('Two B');
    expect(chapters[0].topics).toHaveLength(2);
  });
  it('sends only titled rows plus the idempotency key', () => {
    const p = applyPayload([{ title: ' One ', topics: [{ title: ' a ' }, { title: ' ' }] }, { title: '', topics: [] }], 'k1');
    expect(p).toEqual({ chapters: [{ title: 'One', page_start: null, page_end: null, topics: [{ title: 'a' }] }], idempotency_key: 'k1' });
  });
  it('words the result', () => {
    expect(applyResultText({ chapters_created: 1, topics_created: 4, errors: [] })).toBe('Added 1 chapter and 4 topics.');
    expect(applyResultText({ chapters_created: 2, topics_created: 1, errors: ['x'] })).toBe('Added 2 chapters and 1 topic; 1 could not be added.');
    expect(applyResultText(undefined)).toBe('Added 0 chapters and 0 topics.');
  });
});
