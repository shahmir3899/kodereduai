import {
  addDays, barSpan, buildImportPayload, buildTermPayload, buildYearPayload, canApplyImport, emptyImportForm, emptyYearForm, formatDay,
  importResultText, newTermForm, nextTermDefaults, setCurrentMessage, termClashes, termToForm, validateImport, validateTerm, validateYear,
  warningsToConfirm, yearStatus, yearWarnings, type ManagedTerm, type ManagedYear,
} from '../services/academicSessions';

const year = (o: Partial<ManagedYear> = {}): ManagedYear => ({ id: 1, name: '2025-2026', start_date: '2025-08-01', end_date: '2026-06-30', ...o });
const term = (o: Partial<ManagedTerm> = {}): ManagedTerm => ({ id: 1, academic_year: 1, name: 'Term 1', term_type: 'TERM', order: 1, start_date: '2025-08-01', end_date: '2025-10-30', ...o });

describe('dates', () => {
  it('adds days and formats like the server', () => {
    expect(addDays('2025-12-30', 3)).toBe('2026-01-02');
    expect(formatDay('2026-09-14')).toBe('14 Sep 2026');
    expect(formatDay('')).toBe('');
  });
});

describe('year form', () => {
  const f = { name: ' 2026-2027 ', startDate: '2026-08-01', endDate: '2027-06-30' };
  it('needs a name and ordered dates', () => {
    expect(validateYear(emptyYearForm())).toMatch(/name/);
    expect(validateYear({ ...f, endDate: '2026-08-01' })).toMatch(/after/);
    expect(validateYear(f)).toBeNull();
  });
  it('warns about overlap and odd length, like the server', () => {
    expect(yearWarnings(f, [year()])).toEqual([]);
    expect(yearWarnings({ startDate: '2026-05-01', endDate: '2027-04-30' }, [year()])[0]).toMatch(/overlap 2025-2026 \(1 Aug 2025 - 30 Jun 2026\)/);
    expect(yearWarnings({ startDate: '2026-08-01', endDate: '2026-09-01' }, [])).toEqual(['This year is only 31 days long.']);
    expect(yearWarnings({ startDate: '2026-01-01', endDate: '2027-12-31' }, [])[0]).toMatch(/more than a year/);
    expect(yearWarnings({ startDate: '', endDate: '' }, [year()])).toEqual([]);
  });
  it('sends confirm_warnings only when confirmed', () => {
    expect(buildYearPayload(f, false)).toEqual({ name: '2026-2027', start_date: '2026-08-01', end_date: '2027-06-30' });
    expect(buildYearPayload(f, true)).toMatchObject({ confirm_warnings: true });
  });
  it('labels status and the set-current dialog', () => {
    expect(yearStatus(year({ is_current: true }), '2026-01-01')?.label).toBe('Current year');
    expect(yearStatus(year(), '2027-01-01')?.label).toBe('Past');
    expect(yearStatus(year(), '2025-01-01')?.label).toBe('Upcoming');
    expect(yearStatus(year(), '2025-09-01')).toBeNull();
    expect(setCurrentMessage(year(), '2025-01-01')).toMatch(/not started/);
    expect(setCurrentMessage(year(), '2027-01-01')).toMatch(/already ended/);
    expect(setCurrentMessage(year(), '2025-09-01')).not.toMatch(/It has/);
  });
});

describe('terms', () => {
  it('starts the first term on the year start and later ones the day after', () => {
    expect(nextTermDefaults(year(), [])).toEqual({ order: 1, start_date: '2025-08-01' });
    expect(nextTermDefaults(year(), [term()])).toEqual({ order: 2, start_date: '2025-10-31' });
    expect(nextTermDefaults(year(), [term({ end_date: '2026-06-30' })]).start_date).toBe('');
  });
  it('proposes a 90 day term capped at the year end', () => {
    expect(newTermForm(year(), [])).toMatchObject({ name: 'Term 1', order: '1', startDate: '2025-08-01', endDate: '2025-10-29' });
    expect(newTermForm(year(), [term({ end_date: '2026-06-15' })])).toMatchObject({ startDate: '2026-06-16', endDate: '2026-06-30' });
    expect(newTermForm(year(), [term({ end_date: '2026-06-30' })])).toBeNull();
  });
  it('blocks bad terms and only warns on overlap', () => {
    const f = termToForm(term());
    expect(validateTerm(f, year())).toBeNull();
    expect(validateTerm({ ...f, name: ' ' }, year())).toMatch(/name/);
    expect(validateTerm({ ...f, endDate: '2025-08-01' }, year())).toMatch(/after/);
    expect(validateTerm({ ...f, startDate: '2025-07-01' }, year())).toMatch(/inside the year/);
    expect(termClashes(f, [term({ id: 2, start_date: '2025-10-30', end_date: '2026-01-30' })])).toEqual([]);
    expect(termClashes(f, [term({ id: 2, start_date: '2025-10-01', end_date: '2026-01-30' })])).toHaveLength(1);
  });
  it('builds the payload', () => {
    const f = { ...termToForm(term()), name: ' Term A ', order: 'x' };
    expect(buildTermPayload(f, 7, false)).toEqual({ academic_year: 7, name: 'Term A', term_type: 'TERM', order: 1, start_date: '2025-08-01', end_date: '2025-10-30' });
    expect(buildTermPayload(f, null, true)).toMatchObject({ confirm_warnings: true });
    expect(buildTermPayload(f, null, true)).not.toHaveProperty('academic_year');
  });
  it('places a span on the bar', () => {
    expect(barSpan('2025-08-01', '2025-08-10', '2025-08-01', '2025-08-20')).toEqual({ left: 0, width: 50 });
    expect(barSpan('2025-08-11', '2025-08-20', '2025-08-01', '2025-08-20')).toEqual({ left: 50, width: 50 });
    expect(barSpan('', '', '2025-08-01', '2025-08-20')).toBeNull();
  });
});

describe('server answers', () => {
  it('reads a request to confirm', () => {
    const err = { response: { data: { non_field_errors: ['These dates overlap X.'], confirm_warnings: ['Review'] } } };
    expect(warningsToConfirm(err)).toEqual(['These dates overlap X.']);
    expect(warningsToConfirm({ response: { data: { confirm_warnings: ['Confirm'] } } })).toEqual(['Please review this change.']);
    expect(warningsToConfirm({ response: { data: { name: ['Taken'] } } })).toBeNull();
    expect(warningsToConfirm(null)).toBeNull();
  });
});

describe('import', () => {
  it('needs two different years', () => {
    expect(validateImport(emptyImportForm(2))).toMatch(/Choose/);
    expect(validateImport({ ...emptyImportForm(2), sourceYearId: 2 })).toMatch(/different/);
    expect(validateImport({ ...emptyImportForm(2), sourceYearId: 1 })).toBeNull();
  });
  it('builds the payload and decides if it can apply', () => {
    expect(buildImportPayload({ sourceYearId: 1, targetYearId: 2, conflictMode: 'update', includeInactive: true }))
      .toEqual({ source_academic_year_id: 1, target_academic_year_id: 2, conflict_mode: 'update', include_inactive: true });
    expect(canApplyImport(null)).toBe(false);
    expect(canApplyImport({ counts: { create: 2, conflict: 1 } })).toBe(false);
    expect(canApplyImport({ counts: { skip: 3 } })).toBe(false);
    expect(canApplyImport({ counts: { create: 1, update: 1 } })).toBe(true);
    expect(importResultText({ applied: { created: 2, updated: 1, skipped: 0 } })).toBe('Imported terms (2 created, 1 updated, 0 skipped).');
  });
});
