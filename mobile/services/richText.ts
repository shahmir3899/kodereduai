// Question text is one HTML string, written by the same editor on web and mobile (frontend richEditorCore.js, run on the
// phone inside a WebView). Pure helpers around it; the language wrapper functions mirror the web's and are pinned to
// docs/paper-contract/rich-html.json by __tests__/richText.test.ts.

export const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ur', label: 'اردو (Urdu)' },
  { code: 'ar', label: 'العربية (Arabic)' },
  { code: 'ps', label: 'پښتو (Pashto)' },
  { code: 'sd', label: 'سنڌي (Sindhi)' },
] as const;

const RTL = new Set(['ur', 'ar', 'sd', 'ps']);
export const isRTLLanguage = (code: string): boolean => RTL.has(code);

const WRAPPER_RE = /^<div dir="(ltr|rtl)"(?: lang="([a-z]{2})")?[^>]*>([\s\S]*)<\/div>$/i;

export function unwrapLanguage(html: string | null | undefined): { language: string; inner: string } {
  if (!html) return { language: 'en', inner: '' };
  const m = html.match(WRAPPER_RE);
  if (m) return { language: m[2] || (m[1] === 'rtl' ? 'ur' : 'en'), inner: m[3] };
  return { language: 'en', inner: html };
}

export function wrapLanguage(inner: string, language: string): string {
  const rtl = isRTLLanguage(language);
  return `<div dir="${rtl ? 'rtl' : 'ltr'}" lang="${language}" class="${rtl ? 'font-rtl' : ''}">${inner}</div>`;
}

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

// Question text for a list row or a summary: tags removed, entities decoded, runs of white space collapsed.
export function plainText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

// True when the text has nothing a student could read: no words, and no table or equation either.
export function isBlankHtml(html: string | null | undefined): boolean {
  if (!html) return true;
  if (/<table|<img|data-type="inlineMath"/i.test(html)) return false;
  return plainText(html) === '';
}

export type ToolbarItem = { name: string; label: string; hint: string; flag?: string };

export const TOOLBAR: ToolbarItem[] = [
  { name: 'undo', label: '↶', hint: 'Undo' },
  { name: 'redo', label: '↷', hint: 'Redo' },
  { name: 'bold', label: 'B', hint: 'Bold', flag: 'bold' },
  { name: 'italic', label: 'I', hint: 'Italic', flag: 'italic' },
  { name: 'strike', label: 'S', hint: 'Strikethrough', flag: 'strike' },
  { name: 'underline', label: 'U', hint: 'Underline', flag: 'underline' },
  { name: 'subscript', label: 'x₂', hint: 'Subscript', flag: 'subscript' },
  { name: 'superscript', label: 'x²', hint: 'Superscript', flag: 'superscript' },
  { name: 'heading1', label: 'H1', hint: 'Heading 1', flag: 'heading1' },
  { name: 'heading2', label: 'H2', hint: 'Heading 2', flag: 'heading2' },
  { name: 'bulletList', label: '•', hint: 'Bullet list', flag: 'bulletList' },
  { name: 'orderedList', label: '1.', hint: 'Numbered list', flag: 'orderedList' },
  { name: 'insertTable', label: '▦', hint: 'Insert table' },
  { name: 'equation', label: '∑', hint: 'Insert equation' },
  { name: 'clear', label: 'Tx', hint: 'Clear formatting' },
];

export const TABLE_TOOLBAR: ToolbarItem[] = [
  { name: 'addColumn', label: '+Col', hint: 'Add column' },
  { name: 'addRow', label: '+Row', hint: 'Add row' },
  { name: 'deleteTable', label: '⊟', hint: 'Delete table' },
];

// Messages between the app and the editor page (see frontend/src/components/richEditorEntry.js).
export type PageMessage =
  | { type: 'ready' }
  | { type: 'change'; html: string; blank: boolean }
  | { type: 'state'; active: Record<string, boolean>; language: string }
  | { type: 'height'; px: number };

export function parsePageMessage(raw: unknown): PageMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const m = JSON.parse(raw);
    if (!m || typeof m !== 'object') return null;
    if (m.type === 'ready') return { type: 'ready' };
    if (m.type === 'change' && typeof m.html === 'string') return { type: 'change', html: m.html, blank: !!m.blank };
    if (m.type === 'state' && m.active && typeof m.active === 'object') return { type: 'state', active: m.active, language: String(m.language ?? 'en') };
    if (m.type === 'height' && Number.isFinite(m.px)) return { type: 'height', px: Number(m.px) };
  } catch { /* not ours */ }
  return null;
}

export const initMessage = (html: string, placeholder: string) => JSON.stringify({ type: 'init', html, placeholder });
export const commandMessage = (name: string) => JSON.stringify({ type: 'cmd', name });
export const languageMessage = (code: string) => JSON.stringify({ type: 'lang', code });
export const focusMessage = () => JSON.stringify({ type: 'focus' });

// The editor grows with its text between these heights, then scrolls inside.
export const EDITOR_MIN_HEIGHT = 140;
export const EDITOR_MAX_HEIGHT = 360;
export const clampEditorHeight = (px: number): number => Math.max(EDITOR_MIN_HEIGHT, Math.min(EDITOR_MAX_HEIGHT, Math.round(px)));
