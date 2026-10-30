// Pure logic for the Letter Composer; port of frontend/src/pages/hr/LetterComposerPage.jsx and the
// rules in backend/reports. The PDF is made by the server (the same file the web downloads).
// Admin and principal only.

export interface LetterTemplate { name: string; default_subject: string; default_body: string }
export type TemplateMap = Record<string, LetterTemplate>;

export interface Letter {
  id: number;
  recipient: string;
  subject: string;
  body_text: string;
  line_spacing: string;
  template_type: string;
  template_display?: string;
  created_by_name?: string;
  created_at?: string;
}

export const LINE_SPACINGS = [{ value: 'single', label: 'Single' }, { value: '1.5', label: '1.5' }, { value: 'double', label: 'Double' }] as const;

export interface LetterForm {
  template: string;
  recipient: string;
  subject: string;
  body: string;
  spacing: string;
}

export const emptyLetterForm = (): LetterForm => ({ template: 'custom', recipient: '', subject: '', body: '', spacing: 'single' });

export const letterToForm = (l: Letter): LetterForm => ({
  template: l.template_type || 'custom', recipient: l.recipient, subject: l.subject, body: l.body_text, spacing: l.line_spacing || 'single',
});

// Choosing a template fills the subject and body; the person's own edits are replaced, so the screen
// asks first when there is text already.
export function applyTemplate(form: LetterForm, key: string, templates: TemplateMap): LetterForm {
  const t = templates[key];
  if (!t) return { ...form, template: key };
  return { ...form, template: key, subject: t.default_subject, body: t.default_body };
}

export const hasText = (f: LetterForm) => !!(f.subject.trim() || f.body.trim());

// {employee_name}-style markers still in the text after prefilling (the server lists them too).
export function placeholdersLeft(text: string): string[] {
  return Array.from(new Set((text.match(/\{(\w+)\}/g) ?? []).map((m) => m.slice(1, -1))));
}

export function validateLetter(f: LetterForm): string | null {
  if (!f.recipient.trim()) return 'Enter who the letter is addressed to.';
  if (!f.subject.trim()) return 'Enter a subject.';
  if (!f.body.trim()) return 'Write the letter.';
  const left = placeholdersLeft(`${f.subject} ${f.body}`);
  if (left.length > 0) return `Fill in or remove: ${left.map((p) => `{${p}}`).join(', ')}.`;
  return null;
}

export function buildLetterPayload(f: LetterForm) {
  return { recipient: f.recipient.trim(), subject: f.subject.trim(), body_text: f.body, line_spacing: f.spacing, template_type: f.template };
}

// Inline (unsaved) generation sends the three required fields plus spacing.
export function buildPdfPayload(f: LetterForm) {
  return { recipient: f.recipient.trim(), subject: f.subject.trim(), body_text: f.body, line_spacing: f.spacing };
}

export function letterFileName(subject: string): string {
  const base = (subject || 'Letter').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Letter';
  return `${base}.pdf`;
}
