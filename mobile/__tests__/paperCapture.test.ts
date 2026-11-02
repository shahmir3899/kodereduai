import {
  allocatedMarks, applyExtraction, bankQuestionPayload, captureImageProblem, confirmPayload, dropPage, emptyCapture, hasExtractedPage, isTerminal,
  markFailed, marksNudge, pageLabel, parseDurationMinutes, registerPage, removeReview, removeSection, updateReview, validateReview, worksheetItems,
  type Extracted,
} from '../services/paperCapture';

const extraction: Extracted = {
  header: { exam_title: 'Mid-Term Maths', detected_total_marks: 30, duration_label: '1.5 hours' },
  sections: [
    { title: 'Q1', question_type_guess: 'MCQ', shown_count: 3, counted_count: 3, marks_per_question: 2, questions: [
      { question_text: 'What is 2+2?', question_type: 'MCQ', options: { A: '3', B: '4', C: '5', D: '6' }, marks: 2 },
      { question_text: 'Pick the odd number', question_type: 'MCQ', options: { A: '2', B: '4', C: '5' }, marks: 2 },
    ] },
    { title: 'Q2', instruction: 'Attempt any 2', question_type_guess: 'SHORT', shown_count: 3, counted_count: 2, marks_per_question: 12, questions: [
      { question_text: 'Define a triangle.', question_type: 'SHORT' },
    ] },
  ],
};

describe('reading the answer', () => {
  it('parses duration labels', () => {
    expect(parseDurationMinutes('1.5 hours')).toBe(90);
    expect(parseDurationMinutes('45 minutes')).toBe(45);
    expect(parseDurationMinutes('2 Hours')).toBe(120);
    expect(parseDurationMinutes('soon')).toBeNull();
    expect(parseDurationMinutes(null)).toBeNull();
  });
  it('knows the end states and checks the photo', () => {
    expect(isTerminal('EXTRACTED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(true);
    expect(isTerminal('PROCESSING')).toBe(false);
    expect(captureImageProblem('image/gif', 100)).toMatch(/JPEG/);
    expect(captureImageProblem('image/jpeg', 11 * 1024 * 1024)).toMatch(/too large/);
    expect(captureImageProblem('image/jpeg', 1000)).toBeNull();
  });
});

describe('pages', () => {
  it('registers a page, keeps the group and sorts pages', () => {
    let s = registerPage(emptyCapture(), { id: 11, group_id: 'g-1', page_number: 2 });
    s = registerPage(s, { id: 10, group_id: 'g-1', page_number: 1 });
    expect(s.groupId).toBe('g-1');
    expect(s.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(s.pages[0].status).toBe('processing');
  });
  it('fails a page and drops it so a retry can reuse the number', () => {
    let s = registerPage(emptyCapture(), { id: 10, group_id: 'g', page_number: 1 });
    s = markFailed(s, 10, '');
    expect(s.pages[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/clearer photo/) });
    expect(pageLabel(s.pages[0])).toBe('Failed');
    expect(dropPage(s, 1).pages).toEqual([]);
  });
});

describe('applying an extraction', () => {
  const base = registerPage(emptyCapture(), { id: 10, group_id: 'g', page_number: 1 });
  const s1 = applyExtraction(base, { id: 10, page_number: 1, ai_extracted_json: extraction });
  it('fills the header from the first page only', () => {
    expect(s1.header).toEqual({ title: 'Mid-Term Maths', totalMarks: '30', duration: '90' });
    const withPage2 = applyExtraction(registerPage(s1, { id: 11, group_id: 'g', page_number: 2 }), { id: 11, page_number: 2, ai_extracted_json: { header: { exam_title: 'Other' }, sections: [] } });
    expect(withPage2.header.title).toBe('Mid-Term Maths');
  });
  it('builds sections and questions with page-scoped keys', () => {
    expect(s1.sections).toHaveLength(2);
    expect(s1.sections[0]).toMatchObject({ title: 'Q1', question_type: 'MCQ', slotsShown: 3, slotsCounted: 3, marksPerQuestion: 2 });
    expect(s1.sections[1]).toMatchObject({ slotsShown: 3, slotsCounted: 2, instruction: 'Attempt any 2' });
    expect(s1.sections[0].key).toMatch(/^sec_p1_0_/);
    expect(s1.questions).toHaveLength(3);
    expect(s1.questions[0]).toMatchObject({ text: 'What is 2+2?', type: 'MCQ', marks: '2', sectionKey: s1.sections[0].key });
    expect(s1.questions[2].marks).toBe('12'); // no marks on the question: the section's marks each
    expect(s1.pages[0]).toMatchObject({ status: 'extracted', questionCount: 3 });
  });
  it('keeps keys unique across pages', () => {
    const s2 = applyExtraction(registerPage(s1, { id: 11, group_id: 'g', page_number: 2 }), { id: 11, page_number: 2, ai_extracted_json: extraction });
    const keys = s2.sections.map((x) => x.key);
    expect(new Set(keys).size).toBe(4);
    expect(new Set(s2.questions.map((q) => q.localId)).size).toBe(6);
  });
  it('tolerates an empty reading', () => {
    expect(applyExtraction(base, { id: 10, page_number: 1, ai_extracted_json: null }).questions).toEqual([]);
  });
  it('nudges about the marks', () => {
    expect(allocatedMarks(s1.sections)).toBe(30); // 3*2 + 2*12
    expect(marksNudge(s1)).toBe('All 30 marks captured.');
    expect(marksNudge({ ...s1, header: { ...s1.header, totalMarks: '100' } })).toMatch(/30 of 100/);
    expect(marksNudge({ ...s1, header: { ...s1.header, totalMarks: '10' } })).toMatch(/more than the 10/);
    expect(marksNudge(emptyCapture())).toBeNull();
    expect(hasExtractedPage(s1)).toBe(true);
  });
});

describe('editing and accepting', () => {
  const s = applyExtraction(registerPage(emptyCapture(), { id: 10, group_id: 'g', page_number: 1 }), { id: 10, page_number: 1, ai_extracted_json: extraction });
  it('edits, removes and validates', () => {
    const id = s.questions[0].localId;
    expect(updateReview(s, id, { text: 'New' }).questions[0].text).toBe('New');
    expect(removeReview(s, id).questions).toHaveLength(2);
    expect(removeSection(s, s.sections[0].key).questions.filter((q) => q.sectionKey === '')).toHaveLength(2);
    expect(validateReview(s)).toBeNull();
    expect(validateReview(updateReview(s, id, { text: ' ' }))).toMatch(/text/);
    expect(validateReview(emptyCapture())).toMatch(/at least one page/);
    expect(validateReview({ ...s, questions: [] })).toMatch(/no questions/);
  });
  it('builds the bank question, the confirm and the worksheet items', () => {
    const q = s.questions[0];
    expect(bankQuestionPayload(q, 7)).toEqual({
      subject: 7, question_text: 'What is 2+2?', question_type: 'MCQ', marks: 2, difficulty_level: 'MEDIUM', correct_answer: '', answer_text: '', type_data: {},
      option_a: '3', option_b: '4', option_c: '5', option_d: '6',
    });
    expect(bankQuestionPayload(s.questions[2], 7)).not.toHaveProperty('option_a');
    const c = confirmPayload(99, s.questions);
    expect(c.exam_paper_id).toBe(99);
    expect(c.confirmed_data.questions[0]).toMatchObject({ question_text: 'What is 2+2?', question_type: 'MCQ', marks: 2 });
    let n = 0;
    const items = worksheetItems(s.questions, () => `i${(n += 1)}`);
    expect(items[0]).toMatchObject({ localId: 'i1', question: null, text: 'What is 2+2?', type: 'MCQ', sectionKey: s.sections[0].key, marks: '' });
    expect(items).toHaveLength(3);
  });
});
