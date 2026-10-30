import {
  addQuestion, allocatedMarks, assignSection, autoDistribution, buildAutosavePayload, buildEnsurePayload, countIn, dropSection,
  emptyPaperForm, hydrateStructure, isChoice, makeDivider, makeSection, marksOf, moveQuestion, moveSection, orderForSave,
  paperFileName, paperTone, paperTotal, pickedFromPaperRow, reconcileNote, removeQuestion, serializeStructure, setChoice,
  setSlotsCounted, setSlotsShown, sortPapers, statusSteps, totalMarks, validatePaper, type Paper, type PickedQuestion,
} from '../services/paperBuilder';
import type { Question } from '../services/questionBank';

const q = (id: number, marks: number): Question => ({ id, subject: 4, question_text: `Q${id}`, question_type: 'SHORT', difficulty_level: 'EASY', marks });
const base = { ...emptyPaperForm(), title: 'Term 1', classObj: 5, subject: 4 };

describe('picking questions', () => {
  it('adds once, removes and moves within bounds without mutating', () => {
    let picked: PickedQuestion[] = [];
    picked = addQuestion(picked, q(1, 2));
    picked = addQuestion(picked, q(2, 3));
    expect(addQuestion(picked, q(1, 2))).toHaveLength(2);
    expect(moveQuestion(picked, 0, 1).map((p) => p.question)).toEqual([2, 1]);
    expect(moveQuestion(picked, 0, -1)).toBe(picked);
    expect(moveQuestion(picked, 1, 1)).toBe(picked);
    expect(removeQuestion(picked, 1).map((p) => p.question)).toEqual([2]);
    expect(picked.map((p) => p.question)).toEqual([1, 2]);
  });
  it('totals marks using per-paper changes', () => {
    const picked = [{ ...addQuestion([], q(1, 2.5))[0] }, { ...addQuestion([], q(2, 3))[0], override: '5' }, { ...addQuestion([], q(3, 1))[0], override: '0' }];
    expect(marksOf(picked[1])).toBe(5);
    expect(marksOf(picked[2])).toBe(0);
    expect(totalMarks(picked)).toBe(7.5);
  });
});

describe('sections', () => {
  it('builds a question group with a generated choice instruction', () => {
    const s = makeSection(0, { slotsShown: 5, slotsCounted: 3, marksPerQuestion: 2 });
    expect(s).toMatchObject({ title: 'Question # 1', instruction: 'Attempt any 3 questions.', autoInstruction: true });
    expect(isChoice(s)).toBe(true);
    expect(isChoice(makeSection(0))).toBe(false);
    expect(makeDivider(1).title).toBe('Section - B');
  });
  it('adds up marks from questions to attempt, not questions shown, and skips dividers', () => {
    const sections = [makeSection(0, { slotsShown: 10, slotsCounted: 8, marksPerQuestion: 1 }), makeDivider(0), makeSection(1, { slotsShown: 4, marksPerQuestion: 5 })];
    expect(allocatedMarks(sections)).toBe(28);
  });
  it('keeps shown and attempted counts consistent, and the generated instruction in step', () => {
    const s = makeSection(0, { slotsShown: 5, slotsCounted: 3 });
    expect(setSlotsCounted(s, '4')).toMatchObject({ slotsCounted: 4, instruction: 'Attempt any 4 questions.' });
    expect(setSlotsCounted(s, '99').slotsCounted).toBe(5);
    expect(setSlotsShown(s, '3')).toMatchObject({ slotsShown: 3, slotsCounted: 3 });
    expect(setSlotsShown(makeSection(0), '7')).toMatchObject({ slotsShown: 7, slotsCounted: 7 });
    expect(setChoice(makeSection(0, { slotsShown: 5 }), true)).toMatchObject({ slotsCounted: 4, instruction: 'Attempt any 4 questions.' });
    const off = setChoice(s, false);
    expect(off).toMatchObject({ slotsCounted: 5, instruction: '', autoInstruction: false });
    const custom = { ...s, instruction: 'Choose well.', autoInstruction: false };
    expect(setChoice(custom, false).instruction).toBe('Choose well.');
    expect(setSlotsCounted(custom, '2').instruction).toBe('Choose well.');
  });
  it('starts from the web auto layout for a total', () => {
    const [mcq, short, long] = autoDistribution(100);
    expect([mcq.question_type, short.question_type, long.question_type]).toEqual(['MCQ', 'SHORT', 'LONG']);
    expect(allocatedMarks([mcq, short, long])).toBeGreaterThanOrEqual(99);
    expect(allocatedMarks([mcq, short, long])).toBeLessThanOrEqual(101);
    expect(autoDistribution('')[2].slotsShown).toBeGreaterThan(0);
  });
  it('round-trips the structure the server stores', () => {
    const sections = [makeSection(0, { key: 'a', slotsShown: 5, slotsCounted: 3, marksPerQuestion: 2, question_type: 'MCQ' }), { ...makeDivider(0), key: 'd' }];
    const wire = serializeStructure(sections);
    expect(wire[0]).toEqual({ key: 'a', type: 'question_group', title: 'Question # 1', instruction: 'Attempt any 3 questions.', question_type: 'MCQ', slots_shown: 5, slots_counted: 3, marks_per_question: 2 });
    expect(wire[1]).toEqual({ key: 'd', type: 'divider', title: 'Section - A' });
    expect(hydrateStructure(wire)).toMatchObject([{ key: 'a', slotsShown: 5, slotsCounted: 3, marksPerQuestion: 2 }, { key: 'd', type: 'divider' }]);
    expect(hydrateStructure(undefined)).toEqual([]);
    expect(hydrateStructure([{ key: 'x', type: 'question_group', slots_shown: '4', marks_per_question: '1.50' }])[0]).toMatchObject({ slotsShown: 4, slotsCounted: 4, marksPerQuestion: 1.5 });
  });
  it('moves sections without mutating', () => {
    const a = makeSection(0, { key: 'a' });
    const b = makeSection(1, { key: 'b' });
    expect(moveSection([a, b], 0, 1).map((s) => s.key)).toEqual(['b', 'a']);
    expect(moveSection([a, b], 0, -1).map((s) => s.key)).toEqual(['a', 'b']);
  });
});

describe('questions in sections', () => {
  const sections = [makeSection(0, { key: 'a', slotsShown: 2 }), makeSection(1, { key: 'b', slotsShown: 3 })];
  const mk = (id: number, key: string): PickedQuestion => ({ ...addQuestion([], q(id, 1))[0], sectionKey: key });
  it('saves in section order, loose questions last', () => {
    const picked = [mk(1, 'b'), mk(2, ''), mk(3, 'a'), mk(4, 'b'), mk(5, 'gone')];
    expect(orderForSave(picked, sections).map((p) => p.question)).toEqual([3, 1, 4, 2, 5]);
    expect(countIn(picked, 'b')).toBe(2);
  });
  it('assigns a question and frees the questions of a deleted section', () => {
    const picked = [mk(1, ''), mk(2, 'a')];
    expect(assignSection(picked, 1, 'b').map((p) => p.sectionKey)).toEqual(['b', 'a']);
    const dropped = dropSection(sections, picked, 'a');
    expect(dropped.sections.map((s) => s.key)).toEqual(['b']);
    expect(dropped.picked.map((p) => p.sectionKey)).toEqual(['', '']);
  });
  it('takes the total from the sections when there are some, else from the questions', () => {
    expect(paperTotal([mk(1, '')], [])).toBe(1);
    expect(paperTotal([mk(1, '')], sections)).toBe(5);
    expect(reconcileNote([mk(1, '')], sections)).toBe('The sections add up to 5 marks; the questions chosen add up to 1.');
    expect(reconcileNote([mk(1, '')], [])).toBeNull();
    expect(reconcileNote([1, 2, 3, 4, 5].map((n) => mk(n, '')), sections)).toBeNull();
  });
});

describe('validation and payloads', () => {
  const picked = [addQuestion([], q(1, 2))[0], { ...addQuestion([], q(2, 3))[0], override: '4' }];
  it('needs a title, class, subject, sane duration and a question', () => {
    expect(validatePaper({ ...base, title: ' ' }, picked)).toMatch(/title/);
    expect(validatePaper({ ...base, classObj: null }, picked)).toMatch(/class/);
    expect(validatePaper({ ...base, subject: null }, picked)).toMatch(/subject/);
    expect(validatePaper({ ...base, duration: '1.5' }, picked)).toMatch(/minutes/);
    expect(validatePaper(base, [])).toMatch(/at least one/);
    expect(validatePaper({ ...base, duration: '' }, picked)).toBeNull();
    expect(validatePaper(base, picked)).toBeNull();
    expect(validatePaper(base, [{ ...picked[0], override: '-1' }])).toMatch(/marks change/);
  });
  it('checks each section', () => {
    const ok = makeSection(0, { key: 'a', slotsShown: 2 });
    expect(validatePaper(base, picked, [ok])).toBeNull();
    expect(validatePaper(base, picked, [{ ...ok, title: ' ' }])).toMatch(/title/);
    expect(validatePaper(base, picked, [{ ...ok, question_type: '' }])).toMatch(/question type/);
    expect(validatePaper(base, picked, [{ ...ok, slotsShown: 0, slotsCounted: 0 }])).toMatch(/at least one question/);
    expect(validatePaper(base, picked, [{ ...ok, slotsCounted: 3 }])).toMatch(/between 1 and 2/);
    expect(validatePaper(base, picked, [{ ...ok, marksPerQuestion: 0 }])).toMatch(/above zero/);
    expect(validatePaper(base, [{ ...picked[0], sectionKey: 'a' }, { ...picked[1], sectionKey: 'a' }, { ...picked[0], question: 9, sectionKey: 'a' }], [ok])).toMatch(/holds 3/);
    expect(validatePaper(base, picked, [makeDivider(0)])).toBeNull();
  });
  it('builds the draft payload with structure and the total', () => {
    const e = buildEnsurePayload({ ...base, instructions: ' Answer all ' }, picked, []);
    expect(e).toEqual({ paper_title: 'Term 1', class_obj: 5, subject: 4, instructions: 'Answer all', duration_minutes: 60, total_marks: 6, structure: [] });
    expect(buildEnsurePayload({ ...base, duration: '' }, picked, [])).not.toHaveProperty('duration_minutes');
    const withSections = buildEnsurePayload(base, picked, [makeSection(0, { key: 'a', slotsShown: 2, marksPerQuestion: 5 })]);
    expect(withSections.total_marks).toBe(10);
    expect(withSections.structure).toHaveLength(1);
  });
  it('autosaves questions in order with their section and marks change', () => {
    const sections = [makeSection(0, { key: 'a', slotsShown: 2 })];
    const p = buildAutosavePayload(base, [{ ...picked[0], sectionKey: '' }, { ...picked[1], sectionKey: 'a' }], sections);
    expect(p.manual_questions).toEqual([
      { question_id: 2, question_order: 1, section_key: 'a', marks_override: 4 },
      { question_id: 1, question_order: 2, section_key: '', marks_override: null },
    ]);
  });
  it('puts a non-draft paper back to draft for the edit and restores its status after', () => {
    expect(statusSteps(null, 'DRAFT')).toEqual({ first: false, last: false });
    expect(statusSteps(null, 'READY')).toEqual({ first: false, last: true });
    expect(statusSteps('PUBLISHED', 'PUBLISHED')).toEqual({ first: true, last: true });
    expect(statusSteps('READY', 'DRAFT')).toEqual({ first: true, last: false });
  });
});

describe('saved papers', () => {
  it('reads an override only when it differs from the bank marks, and the section', () => {
    expect(pickedFromPaperRow({ id: 1, question: 9, question_order: 1, marks: '2.00', marks_override: '2.00', question_text: 'x' }).override).toBe('');
    expect(pickedFromPaperRow({ id: 1, question: 9, question_order: 1, marks: '2.00', marks_override: '3.00', question_text: 'x', section_key: 'a' })).toMatchObject({ override: '3', sectionKey: 'a' });
    expect(pickedFromPaperRow({ id: 1, question: 9, question_order: 1, marks: '2.00', marks_override: null, question_text: 'x' }).override).toBe('');
  });
  it('names the PDF, colours the status and lists newest first', () => {
    expect(paperFileName('Physics Mid-Term 2026')).toBe('Physics_Mid_Term_2026.pdf');
    expect(paperFileName('')).toBe('Paper.pdf');
    expect(['DRAFT', 'READY', 'PUBLISHED'].map(paperTone)).toEqual(['neutral', 'info', 'success']);
    const p = (id: number, created: string): Paper => ({ id, paper_title: 'a', total_marks: 1, status: 'DRAFT', class_obj: 1, subject: 1, created_at: created });
    expect(sortPapers([p(1, '2026-01-01'), p(2, '2026-03-01')]).map((x) => x.id)).toEqual([2, 1]);
  });
});
