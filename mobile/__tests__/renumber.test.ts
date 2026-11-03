import {
  RENUMBER_ORDERS, applyPayload, attendanceNote, changedRows, manualRows, moveId, previewOrderFor, previewPayload, renumberConfirmText,
  renumberErrorText, renumberResultText, studentIdsOf, type RenumberRow,
} from '../services/renumber';

const row = (student_id: number, name: string, old_roll: string | null, new_roll: string): RenumberRow =>
  ({ enrollment_id: student_id + 100, student_id, name, old_roll, new_roll });

const base = [row(1, 'Ayesha', '1', '1'), row(2, 'Bilal', '3', '2'), row(3, 'Chand', null, '3')];

describe('orders', () => {
  it('offers the four orders the server knows, in web order', () => {
    expect(RENUMBER_ORDERS.map((o) => o.value)).toEqual(['alphabetical', 'roll', 'admission', 'manual']);
  });

  it('previews a manual order from the current roll order', () => {
    expect(previewOrderFor('manual')).toBe('roll');
    expect(previewOrderFor('admission')).toBe('admission');
    expect(previewPayload('manual')).toEqual({ action: 'preview', order: 'roll' });
    expect(previewPayload('alphabetical')).toEqual({ action: 'preview', order: 'alphabetical' });
  });
});

describe('changed rows', () => {
  it('keeps only students whose number changes, treating no number as different', () => {
    expect(changedRows(base).map((r) => r.student_id)).toEqual([2, 3]);
    expect(changedRows([row(1, 'A', '1', '1')])).toEqual([]);
    expect(changedRows([])).toEqual([]);
  });
});

describe('manual order', () => {
  it('moves a student up or down, and ignores a move off either end', () => {
    expect(moveId([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveId([1, 2, 3], 1, 1)).toEqual([1, 3, 2]);
    const ids = [1, 2, 3];
    expect(moveId(ids, 0, -1)).toBe(ids);
    expect(moveId(ids, 2, 1)).toBe(ids);
    expect(moveId(ids, 5, -1)).toBe(ids);
  });

  it('does not change the list it was given', () => {
    const ids = [1, 2, 3];
    moveId(ids, 0, 1);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('numbers the students 1..n in list order, keeping each old number', () => {
    const rows = manualRows(base, [3, 1, 2]);
    expect(rows.map((r) => [r.student_id, r.new_roll, r.old_roll])).toEqual([[3, '1', null], [1, '2', '1'], [2, '3', '3']]);
  });

  it('skips an id the preview does not have', () => {
    expect(manualRows(base, [9, 1]).map((r) => r.student_id)).toEqual([1]);
  });

  it('lists the student ids of a preview in order', () => {
    expect(studentIdsOf(base)).toEqual([1, 2, 3]);
  });
});

describe('the apply request', () => {
  it('sends the order alone, or with the student order for a manual one', () => {
    expect(applyPayload('alphabetical', null)).toEqual({ action: 'apply', order: 'alphabetical' });
    expect(applyPayload('manual', [3, 1, 2])).toEqual({ action: 'apply', order: 'manual', student_ids: [3, 1, 2] });
    expect(applyPayload('manual', null)).toEqual({ action: 'apply', order: 'manual', student_ids: [] });
  });
});

describe('wording', () => {
  it('says what will change before it does', () => {
    expect(renumberConfirmText('Grade 5 - A', 2)).toBe('2 students in Grade 5 - A will get a new roll number. Students who have left keep their old number. This changes the numbers printed on registers, report cards and fee slips.');
    expect(renumberConfirmText('Grade 5 - A', 1)).toContain('1 student in');
  });

  it('reports the result', () => {
    expect(renumberResultText({ changed: 12 })).toBe('Re-numbered 12 students.');
    expect(renumberResultText({ changed: 1 })).toBe('Re-numbered 1 student.');
    expect(renumberResultText(null)).toBe('Re-numbered 0 students.');
  });

  it('warns about attendance records only when there are some', () => {
    expect(attendanceNote(0)).toBe('');
    expect(attendanceNote(undefined)).toBe('');
    expect(attendanceNote(1)).toContain('1 attendance record for');
    expect(attendanceNote(40)).toContain('40 attendance records for');
  });

  it('shows the server reason, or a fallback', () => {
    expect(renumberErrorText({ response: { data: { detail: 'The manual order must list every student in the section exactly once.' } } })).toBe('The manual order must list every student in the section exactly once.');
    expect(renumberErrorText(new Error('Network Error'))).toBe('Could not re-number the section.');
    expect(renumberErrorText(null)).toBe('Could not re-number the section.');
  });
});
