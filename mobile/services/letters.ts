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

// ── Draft with AI ─────────────────────────────────────────────────────────────────────────────

export const AI_PROMPT_MAX = 1000;

export interface AiDraftReply { subject?: string; body_text?: string; fallback?: boolean }

export function validateAiPrompt(prompt: string): string | null {
  const p = prompt.trim();
  if (!p) return 'Describe the letter you want drafted.';
  if (p.length > AI_PROMPT_MAX) return `Keep the description under ${AI_PROMPT_MAX} characters (now ${p.length}).`;
  return null;
}

// What the server is told about the person the letter is about (the same fields the web sends).
export interface AiStaff { full_name?: string; first_name?: string; last_name?: string; employee_id?: string | null; department_name?: string | null; designation_name?: string | null; date_of_joining?: string | null }

export function aiContext(s: AiStaff | null | undefined) {
  if (!s) return null;
  return {
    name: s.full_name || `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(),
    employee_id: s.employee_id ?? '', department: s.department_name ?? '', designation: s.designation_name ?? '', date_of_joining: s.date_of_joining ?? '',
  };
}

// The template key goes along unless the letter is blank, so the AI follows that kind of letter.
export const buildAiPayload = (prompt: string, template: string, staff: AiStaff | null | undefined) => ({
  prompt: prompt.trim(), template_type: template !== 'custom' ? template : '', employee_context: aiContext(staff),
});

// Puts the drafted text into the form; the subject and body are replaced, the recipient and spacing stay.
export function applyAiDraft(form: LetterForm, reply: AiDraftReply | undefined): LetterForm {
  return { ...form, subject: reply?.subject || form.subject, body: reply?.body_text || form.body };
}

export const aiDraftDone = (reply: AiDraftReply | undefined) =>
  reply?.fallback ? 'The AI is unavailable, so a template was loaded. Edit it as needed.' : 'Drafted by AI. Read it and edit as needed.';

export const aiDraftEmpty = (reply: AiDraftReply | undefined) => !(reply?.subject || reply?.body_text);

export function aiErrorText(e: unknown): string {
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data;
  if (data?.error) return data.error;
  return (e as { response?: unknown })?.response ? 'AI drafting failed. Try again.' : 'No connection. Check your internet and try again.';
}
