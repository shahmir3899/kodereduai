import {
  applyTemplate, buildLetterPayload, buildPdfPayload, emptyLetterForm, hasText, letterFileName, letterToForm, placeholdersLeft, validateLetter,
} from '../services/letters';

const templates = { experience: { name: 'Experience Certificate', default_subject: 'Experience Certificate - {employee_name}', default_body: 'This certifies {employee_name}.' } };

describe('templates', () => {
  it('fills the subject and body from a template and keeps the rest', () => {
    const f = applyTemplate({ ...emptyLetterForm(), recipient: 'HR', spacing: 'double' }, 'experience', templates);
    expect(f).toMatchObject({ template: 'experience', recipient: 'HR', spacing: 'double', subject: 'Experience Certificate - {employee_name}' });
  });
  it('switching to a blank or unknown template keeps the text', () => {
    expect(applyTemplate({ ...emptyLetterForm(), body: 'x' }, 'custom', templates)).toMatchObject({ template: 'custom', body: 'x' });
  });
  it('knows when there is text to lose', () => {
    expect(hasText(emptyLetterForm())).toBe(false);
    expect(hasText({ ...emptyLetterForm(), body: 'hi' })).toBe(true);
  });
});

describe('validation', () => {
  const ok = { ...emptyLetterForm(), recipient: 'Whom it may concern', subject: 'Reference', body: 'Dear sir' };
  it('finds unfilled markers once each', () => {
    expect(placeholdersLeft('Hi {employee_name}, {employee_name} of {school_name}')).toEqual(['employee_name', 'school_name']);
    expect(placeholdersLeft('plain')).toEqual([]);
  });
  it('needs a recipient, subject, body and no markers left', () => {
    expect(validateLetter({ ...ok, recipient: ' ' })).toMatch(/addressed/);
    expect(validateLetter({ ...ok, subject: '' })).toMatch(/subject/);
    expect(validateLetter({ ...ok, body: '' })).toMatch(/Write/);
    expect(validateLetter({ ...ok, body: 'Dear {employee_name}' })).toMatch(/\{employee_name\}/);
    expect(validateLetter(ok)).toBeNull();
  });
  it('builds payloads for saving and for the inline PDF', () => {
    expect(buildLetterPayload({ ...ok, template: 'experience', spacing: '1.5' })).toEqual({
      recipient: 'Whom it may concern', subject: 'Reference', body_text: 'Dear sir', line_spacing: '1.5', template_type: 'experience',
    });
    expect(buildPdfPayload(ok)).toEqual({ recipient: 'Whom it may concern', subject: 'Reference', body_text: 'Dear sir', line_spacing: 'single' });
  });
  it('round-trips a saved letter and names the file', () => {
    expect(letterToForm({ id: 1, recipient: 'R', subject: 'S', body_text: 'B', line_spacing: 'double', template_type: '' })).toMatchObject({ template: 'custom', spacing: 'double' });
    expect(letterFileName('Experience Certificate - Ali Khan')).toBe('Experience_Certificate_Ali_Khan.pdf');
    expect(letterFileName('')).toBe('Letter.pdf');
  });
});
