import {
  buildQuestionPayload, difficultyTone, emptyQuestionForm, hasPicture, isEditableType, matchingPairs, pictureProblem, questionToForm, slotsFor,
  typeLabel, validateQuestion, type Question,
} from '../services/questionBank';

const ok = { ...emptyQuestionForm(), subject: 4, text: 'Define a noun.' };

describe('validation', () => {
  it('needs a subject, text and positive marks', () => {
    expect(validateQuestion({ ...ok, subject: null })).toMatch(/subject/);
    expect(validateQuestion({ ...ok, text: ' ' })).toMatch(/Write/);
    expect(validateQuestion({ ...ok, marks: '0' })).toMatch(/above zero/);
    expect(validateQuestion({ ...ok, marks: 'x' })).toMatch(/above zero/);
    expect(validateQuestion(ok)).toBeNull();
  });
  it('multiple choice needs A and B, a valid key, and text for the keyed option', () => {
    const mcq = { ...ok, type: 'MCQ', a: 'x', b: 'y' };
    expect(validateQuestion({ ...mcq, a: '' })).toMatch(/A and B/);
    expect(validateQuestion({ ...mcq, correct: 'E' })).toMatch(/A, B, C or D/);
    expect(validateQuestion({ ...mcq, correct: 'c' })).toMatch(/Option C/);
    expect(validateQuestion({ ...mcq, c: 'z', correct: 'c' })).toBeNull();
    expect(validateQuestion(mcq)).toBeNull();
  });
  it('true/false needs an answer', () => {
    expect(validateQuestion({ ...ok, type: 'TRUE_FALSE' })).toMatch(/True or False/);
    expect(validateQuestion({ ...ok, type: 'TRUE_FALSE', correct: 'true' })).toBeNull();
  });
});

describe('payload', () => {
  it('clears options for non-MCQ and uppercases keys', () => {
    expect(buildQuestionPayload({ ...ok, type: 'SHORT', a: 'stale', correct: ' noun ' })).toMatchObject({ option_a: '', correct_answer: 'noun', marks: 1, question_type: 'SHORT' });
    expect(buildQuestionPayload({ ...ok, type: 'MCQ', a: ' x ', b: 'y', correct: 'b' })).toMatchObject({ option_a: 'x', correct_answer: 'B' });
    expect(buildQuestionPayload({ ...ok, type: 'TRUE_FALSE', correct: 'false' })).toMatchObject({ correct_answer: 'FALSE' });
  });
  it('round-trips and labels', () => {
    const q: Question = { id: 1, subject: 4, question_text: 'Q', question_type: 'MCQ', difficulty_level: 'HARD', marks: '2.00', option_a: 'a', option_b: 'b', correct_answer: 'A', bloom_level: 'apply' };
    expect(questionToForm(q)).toMatchObject({ subject: 4, type: 'MCQ', marks: '2', difficulty: 'HARD', bloom: 'apply', a: 'a', correct: 'A' });
    expect(typeLabel('TRUE_FALSE')).toBe('True / False');
    expect(isEditableType('MATCHING')).toBe(true);
    expect(isEditableType('DRAWING')).toBe(false);
    expect(isEditableType('MCQ')).toBe(true);
    expect(['EASY', 'MEDIUM', 'HARD'].map(difficultyTone)).toEqual(['success', 'warning', 'error']);
  });
});

describe('matching, fill in the blank, topics and pictures', () => {
  const base = { ...emptyQuestionForm(), subject: 4, text: 'Match the capitals.' };
  it('matching needs two items each side and two pairs', () => {
    const m = { ...base, type: 'MATCHING', left: ['France', 'Japan', ''], right: ['Paris', 'Tokyo', ''], pairs: [0, 1, null] as Array<number | null> };
    expect(validateQuestion(m)).toBeNull();
    expect(validateQuestion({ ...m, left: ['France', '', ''] })).toMatch(/left/);
    expect(validateQuestion({ ...m, right: ['Paris', '', ''] })).toMatch(/right/);
    expect(validateQuestion({ ...m, pairs: [0, null, null] })).toMatch(/at least two/);
  });
  it('sends only the filled items, with pairs renumbered to them', () => {
    const m = { ...base, type: 'MATCHING', left: ['France', '', 'Japan'], right: ['', 'Paris', 'Tokyo'], pairs: [1, null, 2] as Array<number | null>, correct: 'x' };
    expect(buildQuestionPayload(m)).toMatchObject({
      type_data: { left_items: ['France', 'Japan'], right_items: ['Paris', 'Tokyo'], pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] },
      correct_answer: '',
    });
  });
  it('ignores a pair that points at an emptied item', () => {
    const m = { ...base, type: 'MATCHING', left: ['A', 'B'], right: ['x', ''], pairs: [0, 1] as Array<number | null> };
    expect(matchingPairs(m)).toEqual([{ left: 0, right: 0 }]);
  });
  it('round-trips a matching question and its pairs', () => {
    const q: Question = { id: 1, subject: 4, question_text: 'Q', question_type: 'MATCHING', difficulty_level: 'EASY', marks: 2, type_data: { left_items: ['A', 'B'], right_items: ['x', 'y'], pairs: [{ left: 0, right: 1 }, { left: 1, right: 0 }] } };
    expect(questionToForm(q)).toMatchObject({ left: ['A', 'B'], right: ['x', 'y'], pairs: [1, 0] });
  });
  it('fill in the blank keeps accepted answers in type_data, comma separated', () => {
    const p = buildQuestionPayload({ ...base, type: 'FILL_BLANK', answer: 'Lahore, lahore ,' });
    expect(p).toMatchObject({ type_data: { accepted_answers: ['Lahore', 'lahore'] }, correct_answer: '' });
    const q: Question = { id: 1, subject: 4, question_text: 'Q', question_type: 'FILL_BLANK', difficulty_level: 'EASY', marks: 1, type_data: { accepted_answers: ['a', 'b'] } };
    expect(questionToForm(q).answer).toBe('a, b');
  });
  it('sends and reads topic tags as ids', () => {
    expect(buildQuestionPayload({ ...base, topics: [3, 5] }).tested_topics).toEqual([3, 5]);
    const q: Question = { id: 1, subject: 4, question_text: 'Q', question_type: 'SHORT', difficulty_level: 'EASY', marks: 1, tested_topics: [7, { id: 9 }] };
    expect(questionToForm(q).topics).toEqual([7, 9]);
  });
  it('offers option pictures only for multiple choice, and checks the file', () => {
    expect(slotsFor('SHORT').map((s) => s.slot)).toEqual(['question', 'answer']);
    expect(slotsFor('MCQ').map((s) => s.slot)).toEqual(['question', 'option_a', 'option_b', 'option_c', 'option_d', 'answer']);
    expect(hasPicture({ ...({} as Question), option_b_image_url: 'https://x/y.png' }, 'option_b')).toBe(true);
    expect(hasPicture({ ...({} as Question), option_b_image_url: null }, 'option_b')).toBe(false);
    expect(hasPicture(null, 'question')).toBe(false);
    expect(pictureProblem('image/gif', 100)).toMatch(/JPEG/);
    expect(pictureProblem('image/png', 6 * 1024 * 1024)).toMatch(/5 MB/);
    expect(pictureProblem('image/png', 1024)).toBeNull();
  });
});
