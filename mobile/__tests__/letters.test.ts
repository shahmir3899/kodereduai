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

describe('drafting a letter with AI', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require('../services/letters');
  it('needs a description of up to 1000 characters', () => {
    expect(m.validateAiPrompt('  ')).toMatch(/describe/i);
    expect(m.validateAiPrompt('x'.repeat(1001))).toMatch(/under 1000.*1001/);
    expect(m.validateAiPrompt('Experience certificate')).toBeNull();
  });
  it('sends the staff details the way the web does, and nothing for no staff', () => {
    expect(m.aiContext(null)).toBeNull();
    expect(m.aiContext({ full_name: 'Sara Khan', employee_id: 'T01', department_name: 'Academic', designation_name: 'Teacher', date_of_joining: '2022-04-01' }))
      .toEqual({ name: 'Sara Khan', employee_id: 'T01', department: 'Academic', designation: 'Teacher', date_of_joining: '2022-04-01' });
    expect(m.aiContext({ first_name: 'Ali', last_name: 'Raza' })).toMatchObject({ name: 'Ali Raza', employee_id: '', department: '' });
  });
  it('passes the template type unless the letter is blank', () => {
    expect(m.buildAiPayload(' Warning for lateness ', 'warning', null)).toEqual({ prompt: 'Warning for lateness', template_type: 'warning', employee_context: null });
    expect(m.buildAiPayload('x', 'custom', { full_name: 'A' }).template_type).toBe('');
  });
  it('puts the drafted subject and body in, and keeps the rest', () => {
    const form = { ...m.emptyLetterForm(), recipient: 'Sara', spacing: 'double', subject: 'old', body: 'old body' };
    expect(m.applyAiDraft(form, { subject: 'New', body_text: 'New body' })).toMatchObject({ recipient: 'Sara', spacing: 'double', subject: 'New', body: 'New body' });
    expect(m.applyAiDraft(form, { body_text: 'Only body' })).toMatchObject({ subject: 'old', body: 'Only body' });
    expect(m.applyAiDraft(form, undefined)).toEqual(form);
  });
  it('says when a template was loaded instead, and when nothing came back', () => {
    expect(m.aiDraftDone({ fallback: true })).toMatch(/unavailable.*template/);
    expect(m.aiDraftDone({ subject: 's' })).toMatch(/Drafted by AI/);
    expect(m.aiDraftEmpty({})).toBe(true);
    expect(m.aiDraftEmpty({ subject: 's' })).toBe(false);
  });
  it('reads the server error, else a fallback, else a connection message', () => {
    expect(m.aiErrorText({ response: { data: { error: 'prompt too long' } } })).toBe('prompt too long');
    expect(m.aiErrorText({ response: { data: {} } })).toMatch(/AI drafting failed/);
    expect(m.aiErrorText(new Error('Network Error'))).toMatch(/connection/i);
  });
});
