import {
  buildConvertPayload, buildEnquiryPayload, buildNotePayload, canCancel, canConfirm, canConvert, canDeleteCancelled, canEdit,
  conversionRate, emptyConvertForm, emptyEnquiryForm, enquiryToForm, filterEnquiries, filterScored, followUpState, formatDay,
  gradeLabel, gradeMismatches, hasFilters, NO_FILTERS, sectionLabel, sourceLabel, statusLabel, summariseConvert, telUrl,
  validateConvert, validateEnquiry, validateNote, GRADES, SOURCES, type Enquiry, type ScoredEnquiry,
} from '../services/admissions';

const enquiry = (over: Partial<Enquiry> = {}): Enquiry => ({
  id: 1, name: 'Ayesha', father_name: 'Bilal', mobile: '0300-1234567', applying_for_grade_level: 3,
  status: 'NEW', source: 'WALK_IN', next_followup_date: null, ...over,
});

describe('reference lists', () => {
  it('has the 13 grades the web offers, numbered 0 to 12', () => {
    expect(GRADES.map((g) => g.value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(gradeLabel(3)).toBe('Class 1');
    expect(gradeLabel(null)).toBe('No grade');
    expect(gradeLabel(40)).toBe('Grade 40');
  });
  it('has the 8 sources of the model', () => {
    expect(SOURCES.map((s) => s.value)).toEqual(['WALK_IN', 'PHONE', 'WEBSITE', 'WHATSAPP', 'REFERRAL', 'SOCIAL_MEDIA', 'AD_CAMPAIGN', 'OTHER']);
    expect(sourceLabel('SOCIAL_MEDIA')).toBe('Social Media');
    expect(sourceLabel('NEW_ONE')).toBe('NEW ONE');
    expect(sourceLabel('')).toBe('–');
  });
  it('labels statuses', () => {
    expect(statusLabel('CONFIRMED')).toBe('Confirmed');
  });
});

describe('funnel', () => {
  it('rounds the converted share and survives zero enquiries', () => {
    expect(conversionRate({ NEW: 3, CONFIRMED: 2, CONVERTED: 1, CANCELLED: 0 })).toBe(17);
    expect(conversionRate({ NEW: 0, CONFIRMED: 0, CONVERTED: 0, CANCELLED: 0 })).toBe(0);
  });
});

describe('what a status allows', () => {
  it('confirms only NEW, converts only CONFIRMED', () => {
    expect(canConfirm({ status: 'NEW' })).toBe(true);
    expect(canConfirm({ status: 'CONFIRMED' })).toBe(false);
    expect(canConvert({ status: 'CONFIRMED' })).toBe(true);
    expect(canConvert({ status: 'NEW' })).toBe(false);
  });
  it('cancels open enquiries and deletes only cancelled ones', () => {
    expect(canCancel({ status: 'NEW' })).toBe(true);
    expect(canCancel({ status: 'CONFIRMED' })).toBe(true);
    expect(canCancel({ status: 'CONVERTED' })).toBe(false);
    expect(canCancel({ status: 'CANCELLED' })).toBe(false);
    expect(canDeleteCancelled({ status: 'CANCELLED' })).toBe(true);
    expect(canDeleteCancelled({ status: 'NEW' })).toBe(false);
  });
  it('locks a converted enquiry against edits', () => {
    expect(canEdit({ status: 'CONVERTED' })).toBe(false);
    expect(canEdit({ status: 'CANCELLED' })).toBe(true);
  });
});

describe('follow-ups', () => {
  const today = '2026-10-29';
  it('classifies open enquiries by date', () => {
    expect(followUpState(enquiry({ next_followup_date: '2026-10-28' }), today)).toBe('overdue');
    expect(followUpState(enquiry({ next_followup_date: today }), today)).toBe('today');
    expect(followUpState(enquiry({ next_followup_date: '2026-11-02' }), today)).toBe('upcoming');
  });
  it('ignores closed enquiries and a missing date', () => {
    expect(followUpState(enquiry({ next_followup_date: '2026-10-01', status: 'CONVERTED' }), today)).toBeNull();
    expect(followUpState(enquiry({ next_followup_date: '2026-10-01', status: 'CANCELLED' }), today)).toBeNull();
    expect(followUpState(enquiry(), today)).toBeNull();
  });
});

describe('filters', () => {
  const rows = [
    enquiry({ id: 1, name: 'Ayesha', father_name: 'Bilal', mobile: '0300111', status: 'NEW', source: 'PHONE', applying_for_grade_level: 3 }),
    enquiry({ id: 2, name: 'Omar', father_name: 'Hamza', mobile: '0321222', status: 'CONFIRMED', source: 'WALK_IN', applying_for_grade_level: 4 }),
  ];
  it('matches the server: name, father or mobile contains the term', () => {
    expect(filterEnquiries(rows, { ...NO_FILTERS, search: 'hamz' }).map((r) => r.id)).toEqual([2]);
    expect(filterEnquiries(rows, { ...NO_FILTERS, search: '0300' }).map((r) => r.id)).toEqual([1]);
    expect(filterEnquiries(rows, { ...NO_FILTERS, search: '  ayesha ' }).map((r) => r.id)).toEqual([1]);
  });
  it('narrows by status, grade and source together', () => {
    expect(filterEnquiries(rows, { ...NO_FILTERS, status: 'CONFIRMED' }).map((r) => r.id)).toEqual([2]);
    expect(filterEnquiries(rows, { ...NO_FILTERS, grade: 3 }).map((r) => r.id)).toEqual([1]);
    expect(filterEnquiries(rows, { ...NO_FILTERS, grade: 0 })).toEqual([]);
    expect(filterEnquiries(rows, { ...NO_FILTERS, source: 'PHONE', status: 'CONFIRMED' })).toEqual([]);
  });
  it('knows when any filter is on, grade 0 (Playgroup) included', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, grade: 0 })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, search: '  ' })).toBe(false);
    expect(hasFilters(NO_FILTERS, 'today')).toBe(true);
  });
});

describe('enquiry form', () => {
  const filled = { ...emptyEnquiryForm(), name: ' Ayesha ', fatherName: 'Bilal', mobile: ' 0300 ' };
  it('needs child, father and mobile', () => {
    expect(validateEnquiry(emptyEnquiryForm())).toMatch(/child/);
    expect(validateEnquiry({ ...filled, name: ' ' })).toMatch(/child/);
    expect(validateEnquiry({ ...filled, fatherName: '' })).toMatch(/father/);
    expect(validateEnquiry({ ...filled, mobile: '' })).toMatch(/mobile/);
    expect(validateEnquiry(filled)).toBeNull();
  });
  it('trims, and leaves a blank grade and date out of a create', () => {
    expect(buildEnquiryPayload(filled, false)).toEqual({
      name: 'Ayesha', father_name: 'Bilal', mobile: '0300', source: 'WALK_IN', notes: '',
    });
  });
  it('sends grade 0 on a create (Playgroup is not "blank")', () => {
    expect(buildEnquiryPayload({ ...filled, grade: 0 }, false).applying_for_grade_level).toBe(0);
  });
  it('sends nulls on an edit so a grade and date can be cleared, and always the three required fields', () => {
    const p = buildEnquiryPayload(filled, true);
    expect(p.applying_for_grade_level).toBeNull();
    expect(p.next_followup_date).toBeNull();
    expect(p).toMatchObject({ name: 'Ayesha', father_name: 'Bilal', mobile: '0300' });
  });
  it('round-trips a record into the form', () => {
    const f = enquiryToForm({ name: 'A', father_name: 'B', mobile: '1', applying_for_grade_level: 0, source: 'PHONE', next_followup_date: '2026-11-01', notes: 'n' });
    expect(f).toEqual({ name: 'A', fatherName: 'B', mobile: '1', grade: 0, source: 'PHONE', followUp: '2026-11-01', notes: 'n' });
    expect(enquiryToForm({}).source).toBe('WALK_IN');
  });
});

describe('notes and phone', () => {
  it('needs text and only writes NOTE or CALL', () => {
    expect(validateNote('  ')).not.toBeNull();
    expect(validateNote('Called')).toBeNull();
    expect(buildNotePayload('  Called  ', 'CALL')).toEqual({ note: 'Called', note_type: 'CALL' });
  });
  it('builds a dialable tel link', () => {
    expect(telUrl('0300-123 4567')).toBe('tel:03001234567');
    expect(telUrl('+92 300 1234567')).toBe('tel:+923001234567');
    expect(telUrl('  ')).toBeNull();
    expect(telUrl('n/a')).toBeNull();
  });
});

describe('conversion', () => {
  it('starts with the web defaults', () => {
    const f = emptyConvertForm(7);
    expect(f).toEqual({ yearId: 7, sectionId: null, generateFees: false, feeTypes: ['ADMISSION', 'ANNUAL'] });
  });
  it('asks for year, section and at least one fee type when fees are on', () => {
    expect(validateConvert(emptyConvertForm(), 0)).toMatch(/at least one/);
    expect(validateConvert(emptyConvertForm(), 2)).toMatch(/year/);
    expect(validateConvert(emptyConvertForm(7), 2)).toMatch(/section/);
    const ok = { ...emptyConvertForm(7), sectionId: 9 };
    expect(validateConvert(ok, 2)).toBeNull();
    expect(validateConvert({ ...ok, generateFees: true, feeTypes: [] }, 2)).toMatch(/fee type/);
  });
  it('sends fee types only when fees are on, and the section, never a master class', () => {
    const f = { ...emptyConvertForm(7), sectionId: 9 };
    expect(buildConvertPayload([1, 2], f)).toEqual({
      enquiry_ids: [1, 2], academic_year_id: 7, session_class_id: 9, generate_fees: false, fee_types: [],
    });
    expect(buildConvertPayload([1], { ...f, generateFees: true, feeTypes: ['MONTHLY'] })).toMatchObject({ generate_fees: true, fee_types: ['MONTHLY'] });
  });
  it('labels a section with its letter', () => {
    expect(sectionLabel({ display_name: 'Class 2', section: 'B' })).toBe('Class 2 - B');
    expect(sectionLabel({ display_name: 'Class 2', section: null })).toBe('Class 2');
  });
  it('lists children who applied for another grade than the section', () => {
    const rows = [enquiry({ name: 'A', applying_for_grade_level: 3 }), enquiry({ name: 'B', applying_for_grade_level: 4 }), enquiry({ name: 'C', applying_for_grade_level: null })];
    expect(gradeMismatches(rows, { grade_level: 3 })).toEqual(['B']);
    expect(gradeMismatches(rows, null)).toEqual([]);
    expect(gradeMismatches(rows, { grade_level: null })).toEqual([]);
  });
  it('summarises a full, a partial and a failed run', () => {
    expect(summariseConvert({ converted_count: 1, fees_generated_count: 2 })).toMatchObject({ message: '1 enquiry converted to students with 2 fee records.', allFailed: false });
    const partial = summariseConvert({ converted_count: 2, errors: [{ enquiry_id: 3, name: 'Zed', error: 'boom\ntrace line' }] });
    expect(partial.failures).toEqual(['Zed: boom']);
    expect(partial.message).toBe('2 enquiries converted to students.');
    expect(summariseConvert({ converted_count: 0 }).allFailed).toBe(true);
    expect(summariseConvert(null).message).toBe('No enquiry was converted.');
  });
});

describe('conversion likelihood', () => {
  const rows = ['HIGH', 'LOW', 'HIGH', 'MEDIUM'].map((likelihood, i) => ({ enquiry_id: i, student_name: `S${i}`, source: 'PHONE', likelihood, score: 50 })) as ScoredEnquiry[];
  it('filters by level and keeps all for no level', () => {
    expect(filterScored(rows, '')).toHaveLength(4);
    expect(filterScored(rows, 'HIGH').map((r) => r.enquiry_id)).toEqual([0, 2]);
  });
});

describe('dates', () => {
  it('formats a plain date without a time-zone shift', () => {
    expect(formatDay('2026-01-05')).toBe('5 Jan 2026');
    expect(formatDay(null)).toBe('–');
  });
});
