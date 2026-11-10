import {
  buildMovePayload, buildRestorePayload, canDeleteDocument, canRepriceFees, deletedLine, deletedMeta, docLine, emptyMoveForm,
  feeBlockers, feeImpactLines, isRollConflict, keptRecordsLine, moveWarningLines, movePreviewParams, namesMatch, validateMove,
  validateRemove, viewableUrl,
} from '../services/studentMove';

describe('remove', () => {
  it('matches the typed name loosely on case and spaces, not on content', () => {
    expect(namesMatch('  ali raza ', 'Ali Raza')).toBe(true);
    expect(namesMatch('Ali', 'Ali Raza')).toBe(false);
  });

  it('needs the name and a reason', () => {
    expect(validateRemove('x', 'Ali Raza', 'dup')).toContain('exactly');
    expect(validateRemove('Ali Raza', 'Ali Raza', ' ')).toContain('reason');
    expect(validateRemove('Ali Raza', 'Ali Raza', 'duplicate entry')).toBeNull();
  });

  it('says what stays with the student', () => {
    expect(keptRecordsLine({ attendance: 12, fees: 3, marks: 0, enrollments: 1 })).toBe('Kept with the student: 12 attendance, 3 fee, 1 enrollment records.');
    expect(keptRecordsLine({})).toBe('The student has no other records.');
    expect(keptRecordsLine(undefined)).toBe('The student has no other records.');
  });
});

describe('recently deleted', () => {
  const s = { id: 1, name: 'Ali', roll_number: '4', class_name: 'Grade 1', deleted_at: '2026-11-01T09:30:00Z', deleted_by: 'qaisar' };

  it('describes a row', () => {
    expect(deletedLine(s)).toBe('Roll 4  ·  Grade 1');
    expect(deletedMeta(s)).toBe('Removed 2026-11-01 by qaisar');
    expect(deletedMeta({ id: 2, name: 'x' })).toBe('');
  });

  it('spots a roll conflict, and only that 409', () => {
    expect(isRollConflict({ response: { status: 409, data: { code: 'roll_conflict' } } })).toBe(true);
    expect(isRollConflict({ response: { status: 409, data: { code: 'has_history' } } })).toBe(false);
    expect(isRollConflict({ response: { status: 400, data: { code: 'roll_conflict' } } })).toBe(false);
    expect(isRollConflict(new Error('x'))).toBe(false);
  });

  it('sends a roll only when one is typed', () => {
    expect(buildRestorePayload('')).toEqual({});
    expect(buildRestorePayload(' 12 ')).toEqual({ roll_number: '12' });
  });
});

describe('change class', () => {
  const form = { ...emptyMoveForm('2026-11-02'), sectionId: 9, reason: ' moved ' };

  it('asks for a section, a date and a reason', () => {
    expect(validateMove(emptyMoveForm('2026-11-02'), 5)).toContain('section');
    expect(validateMove({ ...form, reason: '' }, 5)).toContain('reason');
    expect(validateMove({ ...form, effectiveDate: '' }, 5)).toContain('first day');
    expect(validateMove(form, 5)).toBeNull();
  });

  it('refuses the section the student is already in unless a new roll is typed', () => {
    expect(validateMove(form, 9)).toContain('already');
    expect(validateMove({ ...form, roll: '7' }, 9)).toBeNull();
  });

  it('sends the preview params and the payload with the roll and fee option only when they apply', () => {
    expect(movePreviewParams(46, form)).toEqual({ academic_year_id: 46, target_session_class_id: 9, effective_date: '2026-11-02' });
    expect(buildMovePayload(46, form, false)).toEqual({ academic_year_id: 46, target_session_class_id: 9, effective_date: '2026-11-02', reason: 'moved' });
    expect(buildMovePayload(46, { ...form, roll: ' 7 ', feeOption: 'reprice' }, true)).toMatchObject({ new_roll_number: '7', fee_option: 'reprice' });
  });

  it('lists the warnings and fee changes the preview reports', () => {
    const preview = {
      warnings: { attendance_since: 3, marks_in_year: 2 },
      fees: { applies: true, can_reprice: false, blockers: ['Tuition: 1 month(s) already have payments.'], annual_note: 'Annual fees stay.',
        categories: [{ name: 'Tuition', old_fee: '1000', new_fee: '1200' }, { name: 'Bus', old_fee: '500', new_fee: '500' }] },
    };
    expect(moveWarningLines(preview)).toHaveLength(2);
    expect(feeImpactLines(preview)).toEqual(['Tuition: PKR 1000 to PKR 1200 a month', 'Annual fees stay.']);
    expect(canRepriceFees(preview)).toBe(false);
    expect(feeBlockers(preview)).toHaveLength(1);
  });

  it('shows nothing about fees for a section move within the same class', () => {
    expect(feeImpactLines({ fees: { applies: false } })).toEqual([]);
    expect(canRepriceFees({ fees: { applies: false } })).toBe(false);
    expect(moveWarningLines(null)).toEqual([]);
  });
});

describe('documents', () => {
  it('describes a document by type and date', () => {
    expect(docLine({ id: 1, title: 'Birth', document_type: 'BIRTH_CERT', created_at: '2026-10-05T10:00:00Z' })).toBe('Birth certificate  ·  2026-10-05');
    expect(docLine({ id: 2, title: 'x', document_type: 'ODD' })).toBe('ODD');
  });

  it('views only real web addresses, not the placeholder paths the web app stored', () => {
    expect(viewableUrl({ file_url: 'https://x.supabase.co/a.pdf' })).toBe('https://x.supabase.co/a.pdf');
    expect(viewableUrl({ file_url: 'uploads/a.pdf' })).toBeNull();
    expect(viewableUrl({ file_url: null })).toBeNull();
  });

  it('keeps earlier branches documents read only', () => {
    expect(canDeleteDocument({ read_only: true })).toBe(false);
    expect(canDeleteDocument({})).toBe(true);
  });
});

describe('adding a student document', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require('../services/studentMove');
  it('needs a file, and nothing else', () => {
    expect(m.newDocumentProblem(m.emptyDocumentForm())).toMatch(/file/i);
    expect(m.newDocumentProblem({ ...m.emptyDocumentForm(), fileUri: 'file:///a.pdf' })).toBeNull();
  });
  it('sends the typed title, else the file name, with the type', () => {
    const f = { ...m.emptyDocumentForm(), fileUri: 'file:///a.pdf', fileName: 'a.pdf', type: 'TC' };
    expect(m.newDocumentFields(f)).toEqual({ title: 'a.pdf', document_type: 'TC' });
    expect(m.newDocumentFields({ ...f, title: '  Transfer letter ' }).title).toBe('Transfer letter');
  });
  it('offers every type except Photo (the profile photo has its own upload)', () => {
    const values = m.DOC_TYPE_OPTIONS.map((o: { value: string }) => o.value);
    expect(values).toContain('BIRTH_CERT');
    expect(values).not.toContain('PHOTO');
  });
});
