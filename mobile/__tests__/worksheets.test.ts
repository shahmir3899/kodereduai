import {
  assignItemSection, buildAutosavePayload, buildEnsurePayload, countInSection, draftFromWorksheet, draftKey, emptyItem, emptyNewWorksheet,
  excludedQuestionIds, isDraft, itemFromQuestion, itemFromRow, moveItem, removeItem, saveLabel, unassignSection, validateItem,
  validateNewWorksheet, worksheetFileName, worksheetTone, type WorksheetItem,
} from '../services/worksheets';

const item = (o: Partial<WorksheetItem> = {}): WorksheetItem => ({ ...emptyItem(), localId: 'a', text: 'Q', ...o });

describe('new worksheet', () => {
  it('needs a class and sends the web payload', () => {
    expect(validateNewWorksheet(emptyNewWorksheet())).toMatch(/class/);
    expect(validateNewWorksheet({ title: '', classObj: 5, subject: null })).toBeNull();
    expect(buildEnsurePayload({ title: ' Fractions ', classObj: 5, subject: 3 })).toEqual({ class_obj: 5, subject: 3, title: 'Fractions', source: 'MANUAL' });
    expect(buildEnsurePayload({ title: ' ', classObj: 5, subject: null })).toEqual({ class_obj: 5, subject: undefined, title: 'Untitled Worksheet', source: 'MANUAL' });
  });
});

describe('items', () => {
  it('validates text, options and answers', () => {
    expect(validateItem(item({ text: ' ' }))).toMatch(/required/);
    expect(validateItem(item())).toBeNull();
    expect(validateItem(item({ type: 'MCQ', options: { A: 'x', B: '', C: '', D: '' } }))).toMatch(/A and B/);
    expect(validateItem(item({ type: 'MCQ', options: { A: 'x', B: 'y', C: '', D: '' }, correct: 'E' }))).toMatch(/A, B, C or D/);
    expect(validateItem(item({ type: 'MCQ', options: { A: 'x', B: 'y', C: '', D: '' }, correct: 'b' }))).toBeNull();
    expect(validateItem(item({ type: 'TRUE_FALSE', correct: 'maybe' }))).toMatch(/True or False/);
    expect(validateItem(item({ marks: 'abc' }))).toMatch(/Marks/);
  });
  it('loads a server row and a bank question', () => {
    const row = itemFromRow({ id: 9, question: 4, item_order: 1, question_text: 'T', question_type: 'MCQ', option_a: 'a', option_b: 'b', marks_override: '2.00', section_key: 's1' });
    expect(row).toMatchObject({ localId: 'existing_9', question: 4, type: 'MCQ', marks: '2', sectionKey: 's1' });
    expect(row.options).toEqual({ A: 'a', B: 'b', C: '', D: '' });
    const bank = itemFromQuestion({ id: 7, subject: 1, question_text: 'B', question_type: 'SHORT', difficulty_level: 'EASY', marks: 3, correct_answer: 'x' });
    expect(bank).toMatchObject({ question: 7, text: 'B', marks: '', correct: 'x' });
    expect(bank.localId).toMatch(/^new_/);
  });
  it('moves, removes, assigns and counts', () => {
    const items = [item({ localId: 'a' }), item({ localId: 'b' }), item({ localId: 'c' })];
    expect(moveItem(items, 0, 1).map((i) => i.localId)).toEqual(['b', 'a', 'c']);
    expect(moveItem(items, 0, -1)).toBe(items);
    expect(removeItem(items, 'b').map((i) => i.localId)).toEqual(['a', 'c']);
    const placed = assignItemSection(items, 'a', 's1');
    expect(countInSection(placed, 's1')).toBe(1);
    expect(unassignSection(placed, 's1').every((i) => i.sectionKey === '')).toBe(true);
    expect(excludedQuestionIds([item({ question: 4 }), item({ question: null })])).toEqual([4]);
  });
});

describe('autosave', () => {
  const d = draftFromWorksheet({ id: 1, title: 'T', class_obj: 5, status: 'DRAFT', instructions: 'I', structure: [{ key: 'a' }], render_options: { x: 1 } });
  it('sends the details and every item in order', () => {
    const p = buildAutosavePayload(d, [item({ localId: 'a', text: 'One', question: 4, marks: '2', type: 'MCQ', options: { A: 'p', B: 'q', C: '', D: '' }, sectionKey: 's' }), item({ localId: 'b', text: 'Two' })]);
    expect(p).toMatchObject({ title: 'T', instructions: 'I', structure: [{ key: 'a' }], render_options: { x: 1 } });
    expect(p.manual_items[0]).toEqual({
      question_id: 4, item_order: 1, section_key: 's', marks_override: 2, question_text: 'One', question_type: 'MCQ', correct_answer: '', answer_text: '', type_data: {},
      option_a: 'p', option_b: 'q', option_c: '', option_d: '',
    });
    expect(p.manual_items[1]).toMatchObject({ question_id: null, item_order: 2, marks_override: null });
  });
  it('changes its key only when something changed', () => {
    const items = [item()];
    expect(draftKey(d, items)).toBe(draftKey({ ...d }, [item()]));
    expect(draftKey(d, items)).not.toBe(draftKey({ ...d, title: 'New' }, items));
    expect(draftKey(d, items)).not.toBe(draftKey(d, [item({ text: 'Other' })]));
  });
  it('words the save state', () => {
    expect(saveLabel('saving', 'DRAFT')).toBe('Saving…');
    expect(saveLabel('saved', 'DRAFT')).toBe('Saved');
    expect(saveLabel('error', 'DRAFT')).toBe('Save failed');
    expect(saveLabel('idle', 'PUBLISHED')).toBe('PUBLISHED');
  });
});

describe('status and files', () => {
  it('knows drafts and tones', () => {
    expect(isDraft({ status: 'DRAFT' })).toBe(true);
    expect(isDraft({ status: 'READY' })).toBe(false);
    expect(worksheetTone('PUBLISHED')).toBe('success');
    expect(worksheetTone('DRAFT')).toBe('neutral');
  });
  it('names the files', () => {
    expect(worksheetFileName('Fractions: Practice!', 'pdf')).toBe('Fractions_Practice.pdf');
    expect(worksheetFileName('', 'docx')).toBe('Worksheet.docx');
  });
});
