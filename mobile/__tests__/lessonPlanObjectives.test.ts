import {
  addSuggestion, bloomLabel, bloomTone, editRow, linkIdsOf, newRow, objectiveSummary, plainText, removeRow, rowsFromPlan, rowsFromText,
  rowsToText, suggestionsFor, type ObjectiveRow,
} from '../services/lessonPlanObjectives';
import { buildPlanPayload, emptyPlanForm, planToForm, type LessonPlan } from '../services/lessonPlans';
import { applyAiDraft } from '../services/lessonPlanTools';

const option = { id: 5, label: 'Grade 5', classObj: null, isSession: false };
const plan = (over: Partial<LessonPlan> = {}): LessonPlan => ({
  id: 1, title: 'Fractions', lesson_date: '2026-11-03', duration_minutes: 40, status: 'DRAFT', class_obj: 5, subject: 2, teacher: 7, ...over,
});

describe('text and rows', () => {
  it('splits text into rows and strips list marks', () => {
    const rows = rowsFromText('- Add halves\n* Add quarters\n1. Compare\n\n  \n2) Explain');
    expect(rows.map((r) => r.statement)).toEqual(['Add halves', 'Add quarters', 'Compare', 'Explain']);
    expect(rows.every((r) => r.objectiveId === null && r.bloom === '')).toBe(true);
  });

  it('writes rows back as a dashed list and drops empty ones', () => {
    const rows = [newRow({ statement: ' Add halves ' }), newRow(), newRow({ statement: 'Compare' })];
    expect(rowsToText(rows)).toBe('- Add halves\n- Compare');
    expect(rowsToText([newRow()])).toBe('');
  });

  it('survives text that arrives as a list or an object', () => {
    expect(plainText(['a', '', 'b'])).toBe('a\nb');
    expect(plainText({ text: 'x' })).toBe('x');
    expect(plainText({ nothing: 1 })).toBe('');
    expect(plainText(null)).toBe('');
    expect(plainText(42)).toBe('42');
  });

  it('keeps unique keys for rows', () => {
    const keys = [newRow(), newRow(), newRow()].map((r) => r.key);
    expect(new Set(keys).size).toBe(3);
  });
});

describe('rows of a saved plan', () => {
  it('prefers the linked curriculum objectives, with their Bloom level', () => {
    const rows = rowsFromPlan({ linked_objectives: [{ id: 4, statement: 'Add halves', bloom_level: 'apply' }], objectives: '- other' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ objectiveId: 4, statement: 'Add halves', bloom: 'apply' });
  });

  it('falls back to the plain text, then to one empty row', () => {
    expect(rowsFromPlan({ objectives_text: '- a\n- b' }).map((r) => r.statement)).toEqual(['a', 'b']);
    const empty = rowsFromPlan({});
    expect(empty).toHaveLength(1);
    expect(empty[0].statement).toBe('');
  });
});

describe('editing rows', () => {
  const base = (): ObjectiveRow[] => [newRow({ objectiveId: 4, statement: 'Add halves', bloom: 'apply' }), newRow({ statement: 'Mine' })];

  it('drops the curriculum link when the words change, but not for a Bloom change', () => {
    const rows = base();
    const bloomOnly = editRow(rows, rows[0].key, { bloom: 'create' });
    expect(bloomOnly[0]).toMatchObject({ objectiveId: 4, bloom: 'create' });
    const reworded = editRow(rows, rows[0].key, { statement: 'Add thirds' });
    expect(reworded[0]).toMatchObject({ objectiveId: null, statement: 'Add thirds' });
    const same = editRow(rows, rows[0].key, { statement: 'Add halves' });
    expect(same[0].objectiveId).toBe(4);
  });

  it('removes a row, and always leaves one to type into', () => {
    const rows = base();
    expect(removeRow(rows, rows[0].key)).toHaveLength(1);
    const last = removeRow([rows[1]], rows[1].key);
    expect(last).toHaveLength(1);
    expect(last[0].statement).toBe('');
  });

  it('lists the curriculum links once each, ignoring empty rows', () => {
    const rows = [newRow({ objectiveId: 4, statement: 'a' }), newRow({ objectiveId: 4, statement: 'a again' }), newRow({ objectiveId: 9, statement: '' }), newRow({ statement: 'own' })];
    expect(linkIdsOf(rows)).toEqual([4]);
  });
});

describe('suggestions', () => {
  const a = { id: 1, statement: 'A', bloom_level: 'remember' };
  const b = { id: 2, statement: 'B', bloom_level: 'apply' };
  const c = { id: 3, statement: 'C' };

  it('merges topics once each and leaves out what is already on the plan', () => {
    const rows = [newRow({ objectiveId: 2, statement: 'B' })];
    expect(suggestionsFor([[a, b], [b, c]], rows).map((o) => o.id)).toEqual([1, 3]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, statement: `s${i}` }));
    expect(suggestionsFor([many], [])).toHaveLength(12);
    expect(suggestionsFor([many], [], 5)).toHaveLength(5);
  });

  it('adds one in place of a trailing empty row, and never twice', () => {
    const rows = [newRow({ statement: 'Mine' }), newRow()];
    const added = addSuggestion(rows, a);
    expect(added.map((r) => r.statement)).toEqual(['Mine', 'A']);
    expect(added[1]).toMatchObject({ objectiveId: 1, bloom: 'remember' });
    expect(addSuggestion(added, a)).toBe(added);
    expect(addSuggestion([newRow({ statement: 'Mine' })], c).map((r) => r.statement)).toEqual(['Mine', 'C']);
  });
});

describe('Bloom labels and the card summary', () => {
  it('labels and colours the levels', () => {
    expect(bloomLabel('analyze')).toBe('Analyze');
    expect(bloomLabel('odd')).toBe('Odd');
    expect(bloomLabel(null)).toBe('');
    expect(bloomTone('remember')).toBe('neutral');
    expect(bloomTone('apply')).toBe('success');
    expect(bloomTone('create')).toBe('error');
    expect(bloomTone(undefined)).toBe('neutral');
  });

  it('shows two objectives and counts the rest', () => {
    const o = (id: number) => ({ id, statement: `s${id}` });
    expect(objectiveSummary([o(1), o(2), o(3), o(4)])).toEqual({ shown: [o(1), o(2)], more: 2 });
    expect(objectiveSummary([o(1)])).toEqual({ shown: [o(1)], more: 0 });
    expect(objectiveSummary(undefined)).toEqual({ shown: [], more: 0 });
  });
});

describe('the plan form with objective rows', () => {
  it('starts with one empty row and loads a saved plan into rows', () => {
    expect(emptyPlanForm('2026-11-03').objectiveRows).toHaveLength(1);
    const f = planToForm(plan({ linked_objectives: [{ id: 4, statement: 'Add halves', bloom_level: 'apply' }] }), [option]);
    expect(f.objectiveRows[0]).toMatchObject({ objectiveId: 4, bloom: 'apply' });
  });

  it('saves the rows as the plan text, falling back to the old text when there are no rows', () => {
    const base = { ...emptyPlanForm('2026-11-03'), title: 'T', classOption: 5, subject: 2, teacher: 7 };
    const withRows = { ...base, objectiveRows: [newRow({ statement: 'Add halves' }), newRow({ statement: 'Compare' })] };
    expect(buildPlanPayload(withRows, option, { school: 1 }).objectives).toBe('- Add halves\n- Compare');
    const textOnly = { ...base, objectives: ' from an old draft ', objectiveRows: [newRow()] };
    expect(buildPlanPayload(textOnly, option, { school: 1 }).objectives).toBe('from an old draft');
  });

  it('turns an AI draft into editable rows, and keeps the rows when the draft has none', () => {
    const f = { ...emptyPlanForm('2026-11-03'), objectiveRows: [newRow({ statement: 'Mine' })] };
    const drafted = applyAiDraft(f, { success: true, objectives: '- One\n- Two' });
    expect(drafted.objectiveRows.map((r) => r.statement)).toEqual(['One', 'Two']);
    expect(applyAiDraft(f, { success: true, title: 'X' }).objectiveRows).toBe(f.objectiveRows);
    expect(applyAiDraft(f, { success: true, objectives: '  ' }).objectiveRows).toBe(f.objectiveRows);
  });
});
