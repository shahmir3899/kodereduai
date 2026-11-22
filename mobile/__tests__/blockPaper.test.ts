import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  answerKeyErrorMessage, answerKeyFileName, blockSetupPayload, emptyClassMessage, headerSwitchOn, kindNoun, fieldControl, fieldLabel, formatMarks, generalProblems, insertBlocks, keptBlocks, letterRowsToText,
  listItemLabel, marksCheck, moveItem, nextSelection, numberFromInput, pictureFileProblem, previewPage, problemsFromError,
  richSummary, scanCardLine, scanMarks, scanSummary, setBlockData, textToLetterRows, thumbUrl, withKey, stillToFillFromError, pickedBlock,
} from '../services/blockPaper';
import {
  applyStructure, isEarlyClass, pickerGroups, stillToFill, structureFromBlocks,
  bankAddedMessage, bankQuestionsToBlocks, countingList, documentMarks, isLostActivity, duplicateBlock, mergeSavedIds, newBlock, newBlockFor, questionNumbers, withMarks, scannedBlocksToBlocks, type Block, type Registry,
} from '../services/shared/blockDocument';
import { describePicture, makerDefaults, setMakerValue } from '../services/shared/pictureRefs';
import { blockReviewFrom } from '../services/paperPages';
import { emptyPaperForm, paperFileName } from '../services/paperBuilder';
import { docxFileName } from '../services/questionExtras';

const registry: Registry = {
  blocks: [
    { type: 'count_write', label: 'Count and write', kind: 'activity', fields: [
      { name: 'rows', label: 'Rows', kind: 'list', min: 1, fields: [{ name: 'picture', label: 'Picture', kind: 'picture' }, { name: 'count', label: 'How many', kind: 'int', min: 1, max: 10 }] },
    ] },
    { type: 'mcq', label: 'Multiple choice', kind: 'text', fields: [
      { name: 'items', label: 'Questions', kind: 'list', min: 1, fields: [
        { name: 'text', label: 'Question', kind: 'richtext' },
        { name: 'options', label: 'Options', kind: 'list', fields: [{ name: 'text', label: 'Option', kind: 'text' }] },
      ] },
    ] },
    { type: 'section_heading', label: 'Section heading', kind: 'layout', fields: [] },
  ],
};

describe('shared copies of the web helpers', () => {
  it.each(['blockDocument.js', 'pictureRefs.js'])('%s is the web file, unchanged', (file) => {
    const web = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/examinations/blocks', file), 'utf8').replace(/\r\n/g, '\n');
    const copy = fs.readFileSync(path.resolve(__dirname, '../services/shared', file), 'utf8').replace(/\r\n/g, '\n');
    const hash = crypto.createHash('sha256').update(web).digest('hex').slice(0, 16);
    expect(copy.split('\n')[0]).toContain(`(${hash})`);
    expect(copy.slice(copy.indexOf('\n') + 1)).toBe(web);
  });

  it('builds, numbers, copies and adds up blocks with the server field list', () => {
    const count = newBlock('count_write', registry);
    expect(count.marks).toBe(5);
    expect(count.data?.rows).toHaveLength(1);
    const heading = newBlock('section_heading', registry);
    expect(heading.marks).toBeUndefined();
    const mcq = newBlock('mcq', registry);
    expect(mcq.data?.items[0].options).toHaveLength(4);
    const blocks = [heading, count, mcq];
    expect(questionNumbers(blocks, registry)).toEqual([null, 1, 2]);
    expect(documentMarks({ blocks }, registry)).toBe(10);
    const clone = duplicateBlock({ ...mcq, question_id: 9 });
    expect(clone.id).not.toBe(mcq.id);
    expect(clone.question_id).toBeUndefined();
  });

  it('keeps question ids the server gives after a save', () => {
    const block: Block = { id: 'b1', type: 'mcq', marks: 2, data: { items: [{ key: 'k1', text: 'x' }] } };
    const merged = mergeSavedIds({ blocks: [block] }, { blocks: [{ id: 'b1', type: 'mcq', question_id: 4, data: { items: [{ key: 'k1', question_id: 7 }] } }] });
    expect(merged.blocks[0].question_id).toBe(4);
    expect(merged.blocks[0].data?.items[0].question_id).toBe(7);
  });

  it('turns bank questions and scanned blocks into editor blocks', () => {
    const bank = bankQuestionsToBlocks([
      { id: 1, question_type: 'MCQ', question_text: 'Which?', marks: 1, option_a: 'A1', option_b: 'B1', correct_answer: 'A' },
      { id: 2, question_type: 'MCQ', question_text: 'Next?', marks: 1, option_a: 'x', option_b: 'y' },
    ]);
    expect(bank).toHaveLength(1);
    expect(bank[0]).toMatchObject({ type: 'mcq', marks: 2 });
    const scanned = scannedBlocksToBlocks([{ id: 'srv', type: 'mcq', page_number: 2, question_id: 5, data: { items: [{ text: 'q' }] } }]);
    expect(scanned[0].id).not.toBe('srv');
    expect(scanned[0].page_number).toBeUndefined();
    expect(scanned[0].data?.items[0].key).toBeTruthy();
  });

  it('describes picture references and the Create tab defaults', () => {
    const catalog = [{ name: 'apple', en: 'Apple', url: 'http://h/api/examinations/paper-picture-library/apple/' }];
    expect(describePicture('apple', { catalog })).toEqual({ label: 'Apple', image: catalog[0].url });
    expect(describePicture({ upload: 3 }, { uploads: [{ id: 3, label: 'Mango', image_url: 'https://s/m.png' }] })).toEqual({ label: 'Mango', image: 'https://s/m.png' });
    expect(describePicture({ make: 'clock', time: '3:30' })?.label).toBe('Drawn: clock (time 3:30)');
    expect(makerDefaults({ kind: 'repeat', label: 'Repeat', fields: { picture: { type: 'picture' }, times: { type: 'int', min: 1, max: 10 }, note: { type: 'text', optional: true } } }))
      .toEqual({ picture: 'apple', times: 3 });
    expect(setMakerValue({ a: 1 }, 'a', '')).toEqual({});
  });
});

describe('the form built from the server field list', () => {
  it('gives each field kind its control', () => {
    const kinds = ['richtext', 'text', 'int', 'number', 'bool', 'picture', 'text_list', 'letter_rows', 'list', 'mystery'];
    expect(kinds.map((kind) => fieldControl({ name: 'f', label: 'F', kind })))
      .toEqual(['richtext', 'text', 'number', 'number', 'bool', 'picture', 'text_list', 'letter_rows', 'list', 'unsupported']);
    expect(fieldControl({ name: 'f', label: 'F', kind: 'choice', choices: ['a'] })).toBe('choice');
    expect(fieldControl({ name: 'f', label: 'F', kind: 'choice' })).toBe('unsupported');
    expect(fieldLabel({ name: 'f', label: 'Picture', kind: 'picture', optional: true })).toBe('Picture (optional)');
  });

  it('reads number boxes as the web does', () => {
    const count = { name: 'count', label: 'How many', kind: 'int', min: 1 };
    expect(numberFromInput('3.6', count)).toBe(4);
    expect(numberFromInput('', count)).toBe(1);
    expect(numberFromInput('', { ...count, optional: true })).toBeUndefined();
    expect(numberFromInput('2,5', { name: 'w', label: 'W', kind: 'number' })).toBe(2.5);
  });

  it('labels list items and converts letter rows', () => {
    expect(listItemLabel({ name: 'options', label: 'Options', kind: 'list' }, 2)).toBe('Option C');
    expect(listItemLabel({ name: 'rows', label: 'Rows', kind: 'list' }, 0)).toBe('Row 1');
    expect(listItemLabel({ name: 'items', label: 'Questions', kind: 'list' }, 1)).toBe('Part 2');
    expect(letterRowsToText([['a', 'b'], ['c']])).toBe('a b\nc');
    expect(textToLetterRows(' a  b \n\n c ')).toEqual([['a', 'b'], ['c']]);
  });

  it('summarises rich text, equations included', () => {
    expect(richSummary('<div dir="rtl"><p>پانی &amp; <b>air</b></p></div>')).toBe('پانی & air');
    expect(richSummary('<p>Area <span data-type="inlineMath" data-latex="x^2"></span></p>')).toBe('Area x^2');
  });

  it('changes block data without touching the original', () => {
    const block: Block = { id: 'a', type: 'mcq', data: { lines: 2 } };
    expect(setBlockData(block, 'lines', undefined).data).toEqual({});
    expect(block.data).toEqual({ lines: 2 });
    expect(withKey({ a: 1 }, 'b', 2)).toEqual({ a: 1, b: 2 });
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
  });
});

describe('the editor', () => {
  const blocks: Block[] = [{ id: 'a', type: 'mcq' }, { id: 'b', type: 'mcq' }, { id: 'c', type: 'mcq' }];

  it('adds after the selected block, else at the end', () => {
    expect(insertBlocks(blocks, 0, [{ id: 'n', type: 'mcq' }]).map((b) => b.id)).toEqual(['a', 'n', 'b', 'c']);
    expect(insertBlocks(blocks, -1, [{ id: 'n', type: 'mcq' }]).map((b) => b.id)).toEqual(['a', 'b', 'c', 'n']);
  });

  it('selects the next block after a delete', () => {
    expect(nextSelection(blocks, 1)).toBe('c');
    expect(nextSelection(blocks, 2)).toBe('b');
    expect(nextSelection([blocks[0]], 0)).toBeNull();
  });

  it('reads the server validation messages', () => {
    expect(problemsFromError({ response: { data: { document: ['Question 2: Rows 1, How many: too big', 'Paper: empty'] } } }))
      .toEqual(['Question 2: Rows 1, How many: too big', 'Paper: empty']);
    expect(problemsFromError({ response: { data: '{"document":["x"]}' } })).toEqual(['x']);
    expect(problemsFromError({ response: { data: 'Server error' } })).toBeNull();
    expect(problemsFromError(new Error('offline'))).toBeNull();
    expect(generalProblems(['Question 1: a', 'Paper: b'])).toEqual(['Paper: b']);
    expect(formatMarks(2.5)).toBe('2.5');
    expect(formatMarks(1 / 3)).toBe('0.33');
  });

  it('sends paper details without total marks or the old structure', () => {
    const payload = blockSetupPayload({ ...emptyPaperForm(), title: '  Maths ', classObj: 3, subject: 4, duration: '45', totalMarks: '100' });
    expect(payload).toEqual({ paper_title: 'Maths', class_obj: 3, subject: 4, exam: null, instructions: '', duration_minutes: 45 });
    expect(blockSetupPayload({ ...emptyPaperForm(), duration: '' })).not.toHaveProperty('duration_minutes');
  });
});

describe('setup', () => {
  it('explains an empty class list by role', () => {
    expect(emptyClassMessage('teacher')).toMatch(/No classes are assigned to you/);
    expect(emptyClassMessage('admin')).toMatch(/no classes set up yet/);
    expect(emptyClassMessage(undefined)).toMatch(/no classes set up yet/);
  });
});

describe('question bank', () => {
  it('brings an activity back with its drawing, and leaves out one without it', () => {
    const block = { type: 'count_write', title: 'Count and write.', marks: 5, data: { rows: [{ picture: 'star', count: 3 }] } };
    const added = bankQuestionsToBlocks([
      { id: 7, question_type: 'ACTIVITY', marks: '4.00', type_data: { block } },
      { id: 8, question_type: 'ACTIVITY', type_data: {} },
    ]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ type: 'count_write', question_id: 7, marks: 4, data: block.data });
    expect(isLostActivity({ question_type: 'ACTIVITY' })).toBe(true);
    expect(bankAddedMessage([{ id: 8, question_type: 'ACTIVITY' }])).toBe('1 activity could not be added because its drawing was not saved.');
  });
});

describe('pictures', () => {
  it('asks for the PNG copy of library pictures only', () => {
    expect(thumbUrl('https://api/api/examinations/paper-picture-library/apple/')).toBe('https://api/api/examinations/paper-picture-library/apple/?format=png');
    expect(thumbUrl('https://storage/x.png')).toBe('https://storage/x.png');
    expect(thumbUrl(null)).toBeNull();
  });

  it('checks an upload as the server does', () => {
    expect(pictureFileProblem('image/png', 1000)).toBeNull();
    expect(pictureFileProblem('image/jpg', 1000)).toBeNull();
    expect(pictureFileProblem('image/svg+xml', 1000)).toMatch(/PNG, JPG or WebP/);
    expect(pictureFileProblem('image/png', 9 * 1024 * 1024)).toMatch(/8 MB/);
  });
});

describe('photo scan review', () => {
  const read: Block[] = [
    { id: '1', type: 'section_heading', title: 'Section A' },
    { id: '2', type: 'count_write', title: 'Count', marks: 4, page_number: 1 },
    { id: '3', type: 'mcq', title: 'Choose', marks: 6, page_number: 2 },
  ];

  it('adds up the kept blocks and checks them against the printed total', () => {
    const kept = keptBlocks(read, [2]);
    expect(kept.map((b) => b.id)).toEqual(['1', '2']);
    expect(scanMarks(kept, registry)).toBe(4);
    expect(marksCheck(10, '10')).toEqual({ ok: true, text: '10 / 10 marks: the questions add up to the total on the paper.' });
    expect(marksCheck(4, 10)?.ok).toBe(false);
    expect(marksCheck(4, null)).toBeNull();
  });

  it('describes the result and each card', () => {
    expect(scanSummary({ blocks: read, pictures: { library: 3, cropped: 1 } }, 2))
      .toBe('3 questions read from 2 pages. Pictures: 3 from the library, 1 cut from the photo. Untick anything that is wrong; you can fix the rest in the editor.');
    expect(scanCardLine(read[2], 2, registry, 2)).toBe('Q2 · Multiple choice · page 2');
    expect(scanCardLine(read[0], null, registry, 1)).toBe('Section heading');
  });

  it('opens the block review only for a finished block scan', () => {
    const pages = [{ page_number: 1, upload_id: 11, status: 'EXTRACTED', error_message: '', image_url: 'https://s/1.jpg' }, { page_number: 2, upload_id: 12, status: 'EXTRACTED', error_message: '' }];
    expect(blockReviewFrom({ complete: true, pages, result: { scan_mode: 'blocks', blocks: read } }))
      .toEqual({ result: { scan_mode: 'blocks', blocks: read }, uploadIds: [11, 12], photos: [{ page_number: 1, image_url: 'https://s/1.jpg' }] });
    expect(blockReviewFrom({ complete: false, pages, result: { scan_mode: 'blocks' } })).toBeNull();
    expect(blockReviewFrom({ complete: true, pages, result: { sections: [] } })).toBeNull();
  });
});

describe('printing', () => {
  it('lays the preview out at A4 width', () => {
    expect(previewPage('<html><head><title>x</title></head></html>')).toBe('<html><head><meta name="viewport" content="width=720"><title>x</title></head></html>');
    expect(previewPage('<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>'))
      .toBe('<head><meta charset="utf-8"><meta name="viewport" content="width=720"></head>');
    expect(previewPage('')).toBe('');
  });

  it('names files in the paper language', () => {
    expect(paperFileName('اردو پرچہ: جماعت 5')).toBe('اردو_پرچہ_جماعت_5.pdf');
    expect(docxFileName('Mid-Term: Maths!')).toBe('Mid_Term_Maths.docx');
    expect(paperFileName('')).toBe('Paper.pdf');
  });
});

describe('worksheets share the block editor (Phase 6b)', () => {
  const reg = { blocks: [{ type: 'short_answer', kind: 'text', label: 'Short', fields: [] }] } as unknown as Registry;

  it('names the kind and keeps worksheet header switches off unless turned on', () => {
    expect(kindNoun('worksheet')).toBe('worksheet');
    expect(kindNoun()).toBe('paper');
    expect(headerSwitchOn({}, 'marks_table')).toBe(true);
    expect(headerSwitchOn({}, 'show_time_marks', 'worksheet')).toBe(false);
    expect(headerSwitchOn({ show_time_marks: true }, 'show_time_marks', 'worksheet')).toBe(true);
  });

  it('a worksheet block starts without marks and an empty box keeps it without', () => {
    expect(newBlockFor('worksheet', 'short_answer', reg)).not.toHaveProperty('marks');
    expect(newBlockFor('paper', 'short_answer', reg).marks).toBe(5);
    const block = { id: 'x', type: 'short_answer', marks: 2 } as Block;
    expect(withMarks(block, '', true)).not.toHaveProperty('marks');
    expect(withMarks(block, '', false).marks).toBe(0);
    expect(withMarks(block, 3, true).marks).toBe(3);
  });
});

describe('answer key (step 7b)', () => {
  it('names the PDF after the paper, keeping Urdu letters', () => {
    expect(answerKeyFileName('Mid Term: Science')).toBe('Mid_Term_Science_answer_key.pdf');
    expect(answerKeyFileName('')).toBe('Paper_answer_key.pdf');
    expect(answerKeyFileName('اردو پرچہ')).toBe('اردو_پرچہ_answer_key.pdf');
  });

  it('explains a refusal and leaves other errors to the usual message', () => {
    expect(answerKeyErrorMessage({ response: { status: 403 } })).toMatch(/answer key/);
    expect(answerKeyErrorMessage({ response: { status: 500 } })).toBeNull();
    expect(answerKeyErrorMessage(new Error('offline'))).toBeNull();
  });
});

describe('counting helper (faster 1)', () => {
  it('uses the same rule as the web', () => {
    expect(countingList(6, 2)).toEqual(['1', '', '3', '', '5', '']);
    expect(countingList(3, 0)).toEqual(['1', '2', '3']);
  });
});

describe('new question defaults (faster 6)', () => {
  it('reuses the marks of the last question of the same type', () => {
    const reg = { blocks: [{ type: 'oral', label: 'Oral', kind: 'activity', fields: [] }] } as Registry;
    expect(newBlockFor('paper', 'oral', reg, [{ id: 'a', type: 'oral', marks: 8 } as Block]).marks).toBe(8);
  });
});

describe('Structure step on the phone', () => {
  const reg = { blocks: [
    { type: 'count_write', label: 'Count and write', kind: 'activity', fields: [{ name: 'rows', label: 'Rows', kind: 'list', max: 12, fields: [
      { name: 'picture', label: 'Picture', kind: 'picture' }, { name: 'count', label: 'How many', kind: 'int', min: 1, max: 7, default: 3 }] }] },
  ] } as Registry;

  it('makes questions from rows and reads them back, same rules as the web', () => {
    const { blocks } = applyStructure([], [{ key: 'k', type: 'count_write', marks: 5, parts: 3 }], reg);
    expect(blocks[0].data?.rows).toHaveLength(3);
    expect(stillToFill(blocks[0], reg)).toBe(true);
    expect(structureFromBlocks(blocks, reg)[0]).toMatchObject({ type: 'count_write', marks: 5, parts: 3, blockId: blocks[0].id });
  });

  it('reads the still-to-fill list from a refused print, as text or bytes', () => {
    const body = JSON.stringify({ detail: 'Some questions are still to fill.', document: ['Still to fill: Question 2: Picture'] });
    expect(stillToFillFromError({ response: { data: body } })).toEqual(['Question 2: Picture']);
    expect(stillToFillFromError({ response: { data: new TextEncoder().encode(body).buffer } })).toEqual(['Question 2: Picture']);
    expect(stillToFillFromError({ response: { data: { document: ['Question 1: Rows 1, How many: must be between 1 and 7.'] } } })).toBeNull();
    expect(stillToFillFromError(new Error('offline'))).toBeNull();
  });

  it('knows which question was tapped on the paper', () => {
    expect(pickedBlock(JSON.stringify({ paperBlock: 'q3' }))).toBe('q3');
    expect(pickedBlock({ paperBlock: 'q4' })).toBe('q4');
    expect(pickedBlock('not json')).toBeNull();
    expect(pickedBlock({ paperShow: 'x' })).toBeNull();
  });
});

describe('question type picker on the phone', () => {
  it('uses the web rule: early classes see activities first', () => {
    const reg = { type_groups: [{ id: 'numbers', label: 'Numbers', early: true }, { id: 'objective', label: 'Quick answers', early: false }],
      blocks: [{ type: 'mcq', label: 'MCQ', kind: 'text', group: 'objective', fields: [] }, { type: 'count_write', label: 'Count', kind: 'activity', group: 'numbers', fields: [] }] } as Registry;
    expect(isEarlyClass('Nursery')).toBe(true);
    expect(pickerGroups(reg, { early: true }).map((g) => g.id)).toEqual(['numbers', 'objective']);
    expect(pickerGroups(reg, { early: false }).map((g) => g.id)).toEqual(['objective', 'numbers']);
  });
});
