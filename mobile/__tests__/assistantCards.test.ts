import { buildEdits, cellsFor, isEditable, CARD_KINDS } from '../services/assistantCards';

const draft = (over: any = {}) => ({ removed: new Set<any>(), amounts: {}, statuses: {}, ...over });

describe('assistant card config', () => {
  it('knows which kinds can be edited', () => {
    expect(isEditable('fee_payments')).toBe(true);
    expect(isEditable('attendance')).toBe(true);
    expect(isEditable('exam_create')).toBe(false);
    expect(isEditable('nope')).toBe(false);
  });

  it('formats money cells and the absent marks cell', () => {
    const paying = cellsFor('fee_payments').find((c) => c.key === 'paying')!;
    expect(paying.format(1500)).toBe((1500).toLocaleString(undefined, { maximumFractionDigits: 2 }));
    const marks = cellsFor('marks_entry').find((c) => c.key === 'marks')!;
    expect(marks.format(0, { absent: true })).toBe('Absent');
  });

  it('sends only the amounts that changed and skips removed rows', () => {
    const rows = [{ id: 1, paying: 500 }, { id: 2, paying: 700 }, { id: 3, paying: 100 }];
    const edits = buildEdits('fee_payments', rows, draft({ removed: new Set([3]), amounts: { 1: '500', 2: '650', 3: '999' } }));
    expect(edits).toEqual({ remove_ids: [3], amounts: { 2: '650' } });
  });

  it('sends only the statuses that changed', () => {
    const rows = [{ student_id: 1, status: 'PRESENT' }, { student_id: 2, status: 'PRESENT' }];
    expect(buildEdits('attendance', rows, draft({ statuses: { 1: 'PRESENT', 2: 'ABSENT' } }))).toEqual({ statuses: { 2: 'ABSENT' } });
  });

  it('returns nothing for an unknown kind or untouched draft', () => {
    expect(buildEdits('nope', [], draft())).toEqual({});
    expect(buildEdits('fee_payments', [{ id: 1, paying: 5 }], draft())).toEqual({});
  });

  it('every card kind has cells and a row id', () => {
    Object.values(CARD_KINDS).forEach((c) => { expect(c.cells.length).toBeGreaterThan(0); expect(c.rowId).toBeTruthy(); });
  });
});
