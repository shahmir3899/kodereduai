import {
  EXIT_TYPES, ITEM_STATE_LABELS, ITEM_STATE_TONES, WAIVER_REASON_MIN_LENGTH, awaySinceText, buildReadmitPayload, buildStartPayload, buildUpdatePayload,
  canFinalize, carryLines, carryText, conflictSummary, emptyExitForm, emptyReadmitForm, exitProblem, exitToForm, finalizeConfirmText,
  finalizeEffects, finalizedText, isTransfer, itemDetailLines, nextFreeRoll, openItems, openItemsText, readmitConfirmText, reasonPayload,
  validateDetails, validateReadmit, waiverProblem, waivedNote, type ExitForm, type ExitItem, type StudentExitCase,
} from '../services/studentExit';

const form = (over: Partial<ExitForm> = {}): ExitForm => ({ ...emptyExitForm('2026-11-03'), ...over });
const transfer = (over: Partial<ExitForm> = {}) => form({ exitType: 'TRANSFERRED', destinationSchool: 4, destinationClass: 9, destinationRoll: '12', ...over });
const item = (over: Partial<ExitItem> = {}): ExitItem => ({ kind: 'FEES', state: 'OPEN', ...over });
const exitCase = (over: Partial<StudentExitCase> = {}): StudentExitCase => ({
  id: 1, student: 7, exit_type: 'WITHDRAWN', status: 'OPEN', leaving_date: '2026-11-03', items: [], ...over,
});

describe('the exit types', () => {
  it('offers withdrawn and transferred', () => {
    expect(EXIT_TYPES.map((t) => t.value)).toEqual(['WITHDRAWN', 'TRANSFERRED']);
  });

  it('starts as a withdrawal today with nothing else filled in', () => {
    expect(emptyExitForm('2026-11-03')).toEqual({ exitType: 'WITHDRAWN', leavingDate: '2026-11-03', reason: '', destinationSchool: null, destinationClass: null, destinationRoll: '' });
    expect(isTransfer(form())).toBe(false);
    expect(isTransfer(transfer())).toBe(true);
  });

  it('continues an exit already started', () => {
    expect(exitToForm(exitCase({ exit_type: 'TRANSFERRED', reason: 'Moving', destination_school: 4, destination_session_class: 9, destination_roll_number: '12' }))).toEqual(transfer({ reason: 'Moving' }));
    expect(exitToForm(exitCase({ reason: null }))).toMatchObject({ reason: '', destinationSchool: null, destinationRoll: '' });
  });
});

describe('the details step', () => {
  it('needs only a date for a withdrawal', () => {
    expect(validateDetails(form())).toBeNull();
    expect(validateDetails(form({ leavingDate: '' }))).toBe('Choose the leaving date.');
    expect(validateDetails(form({ leavingDate: '3/11/2026' }))).toBe('Choose the leaving date.');
  });

  it('needs the branch, the class and the roll for a transfer, in that order', () => {
    expect(validateDetails(transfer())).toBeNull();
    expect(validateDetails(transfer({ destinationSchool: null }))).toBe('Choose the branch the student is transferring to.');
    expect(validateDetails(transfer({ destinationClass: null }))).toBe('Choose the class at the new branch.');
    expect(validateDetails(transfer({ destinationRoll: '  ' }))).toBe('Enter the roll number at the new branch.');
  });

  it('sends no placement for a withdrawal, even if one was picked before switching', () => {
    const payload = buildStartPayload(7, form({ reason: ' moving ', destinationSchool: 4, destinationClass: 9, destinationRoll: '12' }));
    expect(payload).toEqual({ student: 7, exit_type: 'WITHDRAWN', leaving_date: '2026-11-03', reason: 'moving', remove_records_after_leaving: false });
  });

  it('sends the branch, class and roll for a transfer', () => {
    expect(buildStartPayload(7, transfer({ destinationRoll: ' 12 ' }))).toEqual({
      student: 7, exit_type: 'TRANSFERRED', leaving_date: '2026-11-03', reason: '', destination_school: 4, destination_session_class: 9, destination_roll_number: '12', remove_records_after_leaving: false,
    });
  });

  it('never asks the server to delete records after the leaving date', () => {
    expect(buildStartPayload(7, form()).remove_records_after_leaving).toBe(false);
    expect(buildUpdatePayload(transfer()).remove_records_after_leaving).toBe(false);
    expect(buildUpdatePayload(form({ reason: 'x' }))).toEqual({ leaving_date: '2026-11-03', reason: 'x', remove_records_after_leaving: false });
  });

  it('suggests the roll after the highest number taken, ignoring non-numeric rolls', () => {
    expect(nextFreeRoll(['1', '2', '10'])).toBe('11');
    expect(nextFreeRoll(['A1', '7', ' 3 '])).toBe('8');
    expect(nextFreeRoll(['A1', 'B2'])).toBeNull();
    expect(nextFreeRoll([])).toBeNull();
  });
});

describe('the clearance step', () => {
  it('labels and colours each state', () => {
    expect(ITEM_STATE_LABELS).toEqual({ CLEAR: 'Clear', OPEN: 'Open', WAIVED: 'Waived', CARRIED: 'Carried to new branch' });
    expect(ITEM_STATE_TONES).toEqual({ CLEAR: 'success', OPEN: 'error', WAIVED: 'warning', CARRIED: 'info' });
  });

  it('can finalize only an open case with no open item', () => {
    expect(canFinalize(exitCase({ items: [item({ state: 'CLEAR' }), item({ kind: 'LIBRARY', state: 'WAIVED' }), item({ kind: 'GATE_PASS', state: 'CARRIED' })] }))).toBe(true);
    expect(canFinalize(exitCase({ items: [item({ state: 'OPEN' })] }))).toBe(false);
    expect(canFinalize(exitCase({ status: 'FINALIZED' }))).toBe(false);
    expect(canFinalize(exitCase({ status: 'CANCELLED' }))).toBe(false);
    expect(canFinalize(null)).toBe(false);
    expect(openItems(exitCase({ items: [item(), item({ kind: 'LIBRARY', state: 'CLEAR' })] }))).toHaveLength(1);
    expect(openItems(null)).toEqual([]);
  });

  it('needs a waiver reason of at least ten characters, spaces not counted', () => {
    expect(WAIVER_REASON_MIN_LENGTH).toBe(10);
    expect(waiverProblem('short')).toBe('Give a reason of at least 10 characters to waive this item.');
    expect(waiverProblem('   ten chars!   ')).toBeNull();
    expect(waiverProblem('          ')).not.toBeNull();
    expect(waiverProblem('Fee agreed with the principal')).toBeNull();
    expect(reasonPayload('  because  ')).toEqual({ reason: 'because' });
  });

  it('lists each unpaid fee, book and pass under its item', () => {
    expect(itemDetailLines(item({ detail: { items: [{ label: 'Tuition Fee', month: 10, year: 2026, balance: '1900' }, { label: 'Annual Fee', month: 0, year: 2026, balance: 5000 }] } })))
      .toEqual(['Tuition Fee (10/2026): PKR 1,900', 'Annual Fee (2026): PKR 5,000']);
    expect(itemDetailLines(item({ kind: 'LIBRARY', detail: { books: [{ id: 1, title: 'Maths 5', due_date: '2026-10-01', status: 'OVERDUE' }, { id: 2, title: 'Urdu 5', due_date: '2026-11-20', status: 'ISSUED' }] } })))
      .toEqual(['Maths 5, due 2026-10-01 (overdue)', 'Urdu 5, due 2026-11-20']);
    expect(itemDetailLines(item({ kind: 'GATE_PASS', detail: { passes: [{ id: 1, going_to: 'Home', departure_date: '2026-11-02' }] } }))).toEqual(['Out to Home since 2026-11-02']);
  });

  it('has no lines for a clear item', () => {
    expect(itemDetailLines(item({ state: 'CLEAR', detail: {} }))).toEqual([]);
    expect(itemDetailLines(item({ detail: null }))).toEqual([]);
  });

  it('shows what carrying the fees would hand over, and what it would create', () => {
    const plan = { destination: 'Branch 2', total: '6900', lines: [{ fee_type: 'MONTHLY', label: 'Tuition Fee', balance: '1900', month: 10, year: 2026, category_exists: true }, { fee_type: 'ANNUAL', label: 'Books', balance: '5000', month: 0, year: 2026, category_exists: false }] };
    expect(carryLines(plan)).toEqual(['Tuition Fee (10/2026): PKR 1,900', 'Books (2026): PKR 5,000 (category will be created)']);
    expect(carryText(plan)).toBe("PKR 6,900 of unpaid fees becomes Branch 2's to collect, created there as unpaid, and is no longer counted here.");
    expect(carryLines(null)).toEqual([]);
  });

  it('says who waived an item and why', () => {
    expect(waivedNote(item({ state: 'WAIVED', waived_by_name: 'Principal', waived_at: '2026-11-03T09:00:00Z', waiver_reason: 'Agreed with parent' }))).toBe('Waived by Principal on 2026-11-03: Agreed with parent');
    expect(waivedNote(item({ state: 'WAIVED' }))).toBe('Waived by someone:');
  });
});

describe('the review step', () => {
  it('says what finalizing does, with the extra line for a transfer', () => {
    const w = finalizeEffects({ exit_type: 'WITHDRAWN', leaving_date: '2026-11-03' });
    expect(w[0]).toBe("The student is marked Withdrawn and this year's enrollment is closed.");
    expect(w).toHaveLength(4);
    const t = finalizeEffects({ exit_type: 'TRANSFERRED', destination_school_name: 'Branch 2', leaving_date: '2026-11-03' });
    expect(t[0]).toContain('Transferred');
    expect(t[1]).toBe('A new student record is created at Branch 2, starting 2026-11-03.');
    expect(t).toHaveLength(5);
  });

  it('counts the items still open', () => {
    expect(openItemsText(1)).toBe('1 item is still open. Clear or waive it first.');
    expect(openItemsText(2)).toBe('2 items are still open. Clear or waive them first.');
  });

  it('asks before finalizing, and reports it afterwards', () => {
    expect(finalizeConfirmText({ student_name: 'Ayesha', exit_type: 'WITHDRAWN', leaving_date: '2026-11-03' })).toContain('Ayesha will be marked Withdrawn from 2026-11-03.');
    expect(finalizeConfirmText({ exit_type: 'TRANSFERRED', leaving_date: '2026-11-03' })).toContain('This student will be marked Transferred');
    expect(finalizedText({ student_name: 'Ayesha', exit_type: 'TRANSFERRED' })).toBe('Ayesha has been transferred.');
    expect(finalizedText({ exit_type: 'WITHDRAWN' })).toBe('The student has been withdrawn.');
  });
});

describe('what went wrong', () => {
  const err = (data: unknown) => ({ response: { data } });

  it('recognises a leaving date that strands records, with the suggested date', () => {
    const p = exitProblem(err({ detail: 'Ayesha has 12 attendance records on or after 2026-11-03.', suggested_leaving_date: '2026-11-10', last_record_date: '2026-11-09', attendance: { count: 12 }, marks: { count: 0 } }));
    expect(p.kind).toBe('conflict');
    if (p.kind === 'conflict') {
      expect(p.conflict.suggested_leaving_date).toBe('2026-11-10');
      expect(conflictSummary(p.conflict)).toBe('12 attendance records');
    }
  });

  it('recognises a finalize with open items', () => {
    expect(exitProblem(err({ code: 'clearance_incomplete', detail: 'Clear or waive every open item before finalizing: pending fees.', open_items: ['FEES'] })))
      .toEqual({ kind: 'clearance', message: 'Clear or waive every open item before finalizing: pending fees.', openKinds: ['FEES'] });
  });

  it('shows the server wording for any other rule, or its error field', () => {
    expect(exitProblem(err({ detail: 'This exit is no longer open.' }))).toEqual({ kind: 'plain', message: 'This exit is no longer open.' });
    expect(exitProblem(err({ error: 'Nope.' }))).toEqual({ kind: 'plain', message: 'Nope.' });
    expect(exitProblem(err({}), 'Fallback.')).toEqual({ kind: 'plain', message: 'Fallback.' });
  });

  it('tells a lost connection from a refusal', () => {
    expect(exitProblem(new Error('Network Error'))).toEqual({ kind: 'plain', message: 'No connection. Check your internet and try again.' });
    expect(exitProblem(null, 'Fallback.')).toEqual({ kind: 'plain', message: 'Fallback.' });
  });

  it('summarises a conflict with both attendance and marks', () => {
    expect(conflictSummary({ detail: '', attendance: { count: 1 }, marks: { count: 3 } })).toBe('1 attendance record, 3 exam marks');
    expect(conflictSummary({ detail: '' })).toBe('');
  });
});

describe('re-admission', () => {
  it('starts today with nothing chosen', () => {
    expect(emptyReadmitForm('2026-11-03')).toEqual({ returnDate: '2026-11-03', sessionClass: null, roll: '', reason: '' });
  });

  it('needs a return date after the day they left', () => {
    const f = emptyReadmitForm('2026-11-10');
    expect(validateReadmit(f, '2026-11-03')).toBeNull();
    expect(validateReadmit(f)).toBeNull();
    expect(validateReadmit({ ...f, returnDate: '' })).toBe('Choose the return date.');
    expect(validateReadmit({ ...f, returnDate: '2026-11-03' }, '2026-11-03')).toBe('The return date must be after the day they left (2026-11-03).');
    expect(validateReadmit({ ...f, returnDate: '2026-11-01' }, '2026-11-03')).toContain('after the day they left');
    expect(validateReadmit({ ...f, returnDate: '2026-12-01' }, '2026-11-03')).toBeNull();
  });

  it('builds the request, trimmed, with the class optional', () => {
    expect(buildReadmitPayload(7, { returnDate: '2026-11-10', sessionClass: null, roll: ' 4 ', reason: ' back ' })).toEqual({ student: 7, return_date: '2026-11-10', session_class: null, roll_number: '4', reason: 'back' });
    expect(buildReadmitPayload(7, { returnDate: '2026-11-10', sessionClass: 31, roll: '', reason: '' }).session_class).toBe(31);
  });

  it('words the confirmation and the away note', () => {
    expect(readmitConfirmText('Ayesha', { returnDate: '2026-11-10' })).toBe('Ayesha will be re-admitted from 2026-11-10. Their earlier records stay and the time away stays empty.');
    expect(awaySinceText('Ayesha', '2026-10-01')).toBe('Ayesha has been away since 2026-10-01.');
    expect(awaySinceText('Ayesha', null)).toBe('Ayesha is away.');
  });
});
