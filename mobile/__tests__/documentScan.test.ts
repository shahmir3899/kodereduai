import {
  QUALIFICATION_DOC_TYPES, STAFF_DOC_TYPES, STUDENT_DOC_TYPES, anyReading, detailsForm, detailsPayload, docSubline, isImageUrl,
  scanError, scanReplyMessage, typeLabel, validateDetails,
} from '../services/documentScan';

describe('document scan', () => {
  it('has the web type lists, including the newer ones', () => {
    expect(STUDENT_DOC_TYPES.map((t) => t.value)).toEqual(expect.arrayContaining(['B_FORM', 'GUARDIAN_ID', 'PHOTO']));
    expect(STAFF_DOC_TYPES.map((t) => t.value)).toEqual(expect.arrayContaining(QUALIFICATION_DOC_TYPES));
    expect(typeLabel(STUDENT_DOC_TYPES, 'TC')).toBe('Transfer certificate');
    expect(typeLabel(STUDENT_DOC_TYPES, 'NEW_KIND')).toBe('NEW_KIND');
  });

  it('knows when something is still being read, and which files have a picture', () => {
    expect(anyReading([{ scan_status: 'DONE' }, { scan_status: 'PENDING' }])).toBe(true);
    expect(anyReading([{ scan_status: 'NEEDS_REVIEW' }])).toBe(false);
    expect(isImageUrl('https://x/a/b.JPG?token=1')).toBe(true);
    expect(isImageUrl('https://x/a/b.pdf')).toBe(false);
  });

  it('round-trips a record into the form and back, blank dates as null', () => {
    const doc = { id: 1, document_type: 'BIRTH_CERT', title: 'Birth certificate', document_number: 'B-1', issue_date: '2015-03-01', expiry_date: null };
    const f = detailsForm(doc);
    expect(f).toMatchObject({ type: 'BIRTH_CERT', number: 'B-1', issued: '2015-03-01', expiry: '' });
    expect(detailsPayload(f)).toEqual({
      document_type: 'BIRTH_CERT', title: 'Birth certificate', document_number: 'B-1', issue_date: '2015-03-01', expiry_date: null, notes: '',
    });
  });

  it('sends qualification fields only for a qualification type', () => {
    const f = { ...detailsForm({ id: 2, document_type: 'DEGREE', title: 'BSc' }), institution: ' PU ', year: '2010', grade: 'A' };
    expect(detailsPayload(f)).toMatchObject({ institution: 'PU', year_of_completion: 2010, grade_or_percentage: 'A' });
    expect(detailsPayload({ ...f, type: 'CONTRACT' })).not.toHaveProperty('institution');
    expect(detailsPayload(f, { withExpiry: false, withNotes: false })).not.toHaveProperty('expiry_date');
  });

  it('checks the title, dates in order and a sensible year', () => {
    const f = detailsForm({ id: 1, document_type: 'OTHER', title: 'x' });
    expect(validateDetails({ ...f, title: ' ' }, 2026)).toBe('Enter a title.');
    expect(validateDetails({ ...f, issued: '2026-05-01', expiry: '2026-01-01' }, 2026)).toMatch(/before the issue date/);
    expect(validateDetails({ ...f, year: '1890' }, 2026)).toMatch(/1950 to 2027/);
    expect(validateDetails(f, 2026)).toBeNull();
  });

  it('says what happened to an upload and reads the server error', () => {
    expect(scanReplyMessage({ duplicate: true })).toMatch(/already on file/);
    expect(scanReplyMessage({ duplicate: false })).toMatch(/being read/);
    expect(scanError({ response: { data: { error: 'A file is required.' } } })).toBe('A file is required.');
    expect(scanError(new Error('x'))).toMatch(/No connection/);
    expect(docSubline({ id: 1, document_type: 'TC', title: 't', document_number: 'TC-9', created_at: '2026-11-25T10:00:00Z' }, STUDENT_DOC_TYPES))
      .toBe('Transfer certificate  ·  TC-9  ·  2026-11-25');
  });
});
