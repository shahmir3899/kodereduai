import {
  STUDENT_FIELDS, emptyForm, formToPayload, normalizeGender, parsePhone, placementPayload,
  serverFieldErrors, studentToForm, validate,
} from '../services/studentForm';

describe('parsePhone', () => {
  it.each([
    ['03001234567', '+923001234567'],
    ['3001234567', '+923001234567'],
    ['923001234567', '+923001234567'],
    ['+92 300 123 4567', '+923001234567'],
    ['P: 0300-1234567', '+923001234567'],
    ['', ''],
  ])('%s -> %s', (raw, out) => expect(parsePhone(raw)).toBe(out));
});

describe('normalizeGender', () => {
  it.each([['MALE', 'M'], ['female', 'F'], ['Other', 'O'], ['M', 'M'], ['x', ''], [null, '']])('%s', (raw, out) =>
    expect(normalizeGender(raw)).toBe(out));
});

describe('studentToForm and formToPayload', () => {
  it('maps the API student into strings, nulls to empty, gender to a code', () => {
    const form = studentToForm({ name: 'Ali', roll_number: '1', gender: 'MALE', date_of_birth: '2020-01-05', address: null });
    expect(form.name).toBe('Ali');
    expect(form.gender).toBe('M');
    expect(form.address).toBe('');
    expect(form.date_of_birth).toBe('2020-01-05');
  });

  it('sends null for an empty date and normalises only the parent phone', () => {
    const payload = formToPayload({
      ...emptyForm(), name: ' Sara ', roll_number: '2', parent_phone: '03001234567', guardian_phone: '03001234567', admission_date: '',
    });
    expect(payload.name).toBe('Sara');
    expect(payload.parent_phone).toBe('+923001234567');
    expect(payload.guardian_phone).toBe('03001234567');
    expect(payload.admission_date).toBeNull();
  });

  it('never sends the fields the API does not have', () => {
    const payload = formToPayload(emptyForm());
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('phone');
    expect(Object.keys(payload).sort()).toEqual(STUDENT_FIELDS.map((f) => f.name).sort());
  });
});

describe('validate', () => {
  it('requires name and roll number', () => {
    expect(Object.keys(validate(emptyForm())).sort()).toEqual(['name', 'roll_number']);
  });

  it('accepts a minimal valid form', () => {
    expect(validate({ ...emptyForm(), name: 'Ali', roll_number: '1' })).toEqual({});
  });

  it('rejects an impossible date, a bad email and an over-long roll number', () => {
    const errors = validate({
      ...emptyForm(), name: 'Ali', roll_number: 'x'.repeat(21), date_of_birth: '2020-02-31', guardian_email: 'nope',
    });
    expect(errors.date_of_birth).toBeDefined();
    expect(errors.guardian_email).toBeDefined();
    expect(errors.roll_number).toBeDefined();
  });
});

describe('serverFieldErrors', () => {
  it('splits field messages from general ones', () => {
    const r = serverFieldErrors({ roll_number: ['Roll number already used.'], non_field_errors: ['Class is full.'], other: ['odd'] });
    expect(r.fields).toEqual({ roll_number: 'Roll number already used.' });
    expect(r.general).toBe('Class is full. other: odd');
  });

  it('copes with nothing useful', () => {
    expect(serverFieldErrors(undefined)).toEqual({ fields: {}, general: null });
    expect(serverFieldErrors('boom')).toEqual({ fields: {}, general: null });
  });
});

describe('placementPayload', () => {
  it('sends the section and its master class for a session class', () => {
    expect(placementPayload({ id: 9, classObj: 4, isSession: true })).toEqual({ class_obj: 4, session_class_id: 9 });
  });
  it('sends only the class for a master-only option', () => {
    expect(placementPayload({ id: 4, classObj: null, isSession: false })).toEqual({ class_obj: 4 });
  });
  it('is null when nothing is chosen', () => {
    expect(placementPayload(null)).toBeNull();
  });
});
