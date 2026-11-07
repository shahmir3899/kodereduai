import {
  buildReview, changeQuestionType, clampPages, missingBeforeAccept, needsCheck, slotState, toCaptureState, newGroupId, MAX_PAGES, type Reconciled,
} from '../services/paperPages';

const result: Reconciled = {
  header: { exam_title: 'Mid', detected_total_marks: 8, duration_label: '1.5 hours', class_label: 'FIFTH', subject_label: 'SS' },
  sections: [
    { title: 'Objective', question_type_guess: 'MCQ', marks_per_question: 2, shown_count: 3, counted_count: 3, questions: [1, 2, 3].map((n) => ({
      question_text: `<p>q${n}</p>`, question_type: 'MCQ', marks: 2, options: { A: 'a' }, needs_review: n === 3 })) },
    { title: 'Attempt any 1', instruction: 'Attempt any 1', question_type_guess: 'SHORT', marks_per_question: 4, shown_count: 2, counted_count: 1, questions: [
      { question_text: 's1', question_type: 'SHORT', marks: 4 }, { question_text: 's2', question_type: 'SHORT', marks: 4 }] },
  ],
};

describe('buildReview', () => {
  it('turns the joined paper into sections, questions in paper order and the paper details', () => {
    const r = buildReview(result, [11, 12]);
    expect(r.sections.map((s) => [s.title, s.question_type, s.slotsShown, s.slotsCounted])).toEqual([['Objective', 'MCQ', 3, 3], ['Attempt any 1', 'SHORT', 2, 1]]);
    expect(r.questions).toHaveLength(5);
    expect(r.questions[0].sectionKey).toBe(r.sections[0].key);
    expect(needsCheck(r)).toBe(1);
    expect([r.title, r.totalMarks, r.duration, r.classLabel, r.subjectLabel]).toEqual(['Mid', '8', '90', 'FIFTH', 'SS']);
    expect(r.uploadIds).toEqual([11, 12]);
  });

  it('leaves the total empty when none is printed, so it must be filled in', () => {
    const r = buildReview({ header: {}, sections: [] }, []);
    expect(r.totalMarks).toBe('');
    expect(missingBeforeAccept(r)).toEqual(['Paper title', 'Total marks']);
  });

  it('asks for the text of every question', () => {
    const r = buildReview({ header: { exam_title: 'T', detected_total_marks: 2 }, sections: [{ title: 'A', question_type_guess: 'SHORT', shown_count: 1, counted_count: 1, marks_per_question: 2, questions: [{ question_text: ' ', question_type: 'SHORT', marks: 2 }] }] }, []);
    expect(missingBeforeAccept(r)).toEqual(['Text of every question']);
  });
});

describe('changeQuestionType', () => {
  it('splits a uniform section when one question becomes another type and keeps the order', () => {
    const r = buildReview(result, []);
    const id = r.questions[2].localId;
    const next = changeQuestionType(r, id, 'TRUE_FALSE');
    expect(next.sections.map((s) => [s.question_type, s.slotsShown])).toEqual([['MCQ', 2], ['TRUE_FALSE', 1], ['SHORT', 2]]);
    const moved = next.questions.find((q) => q.localId === id)!;
    expect(moved.sectionKey).toBe(next.sections[1].key);
    expect(moved.needsReview).toBe(false);
    expect(next.questions.map((q) => q.localId)).toEqual(r.questions.map((q) => q.localId));
  });

  it('keeps an attempt-any section whole', () => {
    const r = buildReview(result, []);
    const next = changeQuestionType(r, r.questions[3].localId, 'LONG');
    expect(next.sections).toBe(r.sections);
    expect(next.questions[3].type).toBe('LONG');
  });

  it('does nothing when the type is unchanged', () => {
    const r = buildReview(result, []);
    expect(changeQuestionType(r, r.questions[0].localId, 'MCQ')).toBe(r);
  });
});

describe('handing over and page slots', () => {
  it('gives the builder the shape it already accepts, without the review flag', () => {
    const c = toCaptureState(buildReview(result, [5, 6]));
    expect(c.pages.map((p) => [p.uploadId, p.status])).toEqual([[5, 'extracted'], [6, 'extracted']]);
    expect(c.header).toEqual({ title: 'Mid', totalMarks: '8', duration: '90' });
    expect(c.questions.every((q) => !('needsReview' in q))).toBe(true);
  });

  it('merges what the phone is doing with what the server reports', () => {
    expect(slotState('uploading', { page_number: 1, upload_id: 1, status: 'EXTRACTED', error_message: '' })).toBe('uploading');
    expect(slotState(undefined, { page_number: 1, upload_id: null, status: 'MISSING', error_message: '' })).toBe('empty');
    expect(slotState('failed', { page_number: 1, upload_id: null, status: 'MISSING', error_message: '' })).toBe('failed');
    expect(slotState(undefined, { page_number: 1, upload_id: 1, status: 'PROCESSING', error_message: '' })).toBe('processing');
    expect(slotState(undefined, { page_number: 1, upload_id: 1, status: 'FAILED', error_message: '' })).toBe('failed');
    expect(slotState(undefined, { page_number: 1, upload_id: 1, status: 'EXTRACTED', error_message: '' })).toBe('extracted');
  });

  it('keeps the page count in range and makes a uuid-shaped group id', () => {
    expect(clampPages('0')).toBe(1);
    expect(clampPages('abc')).toBe(1);
    expect(clampPages('99')).toBe(MAX_PAGES);
    expect(newGroupId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
