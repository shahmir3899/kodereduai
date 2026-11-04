import fs from 'fs';
import path from 'path';
import {
  clampEditorHeight, commandMessage, initMessage, isBlankHtml, isRTLLanguage, languageMessage, parsePageMessage, plainText, TOOLBAR, unwrapLanguage, wrapLanguage,
} from '../services/richText';
import { RICH_EDITOR_HASH, RICH_EDITOR_HTML } from '../assets/richEditorHtml';
import { validateQuestion, emptyQuestionForm } from '../services/questionBank';

// Shared with the web test of richEditorCore.js: the language wrapper must be the same string on both sides.
const fixtures = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/paper-contract/rich-html.json'), 'utf8'));

describe('language wrapper (same as web)', () => {
  it.each(fixtures.wrap as any[])('wraps and unwraps $language', (w: any) => {
    expect(wrapLanguage(w.inner, w.language)).toBe(w.wrapped);
    expect(unwrapLanguage(w.wrapped)).toEqual({ language: w.language, inner: w.inner });
  });
  it('treats plain or missing text as English', () => {
    expect(unwrapLanguage('')).toEqual({ language: 'en', inner: '' });
    expect(unwrapLanguage(null)).toEqual({ language: 'en', inner: '' });
    expect(unwrapLanguage('5+3=____')).toEqual({ language: 'en', inner: '5+3=____' });
    expect(isRTLLanguage('ur')).toBe(true);
    expect(isRTLLanguage('en')).toBe(false);
  });
  it('reads the language of a wrapper that has no lang', () => {
    expect(unwrapLanguage('<div dir="rtl"><p>x</p></div>').language).toBe('ur');
  });
});

describe('plain text and blank checks', () => {
  it('strips tags and keeps the words readable', () => {
    expect(plainText('<div dir="ltr" lang="en" class=""><p>5 + 3 = ____</p><p>Next&nbsp;line &amp; more</p></div>')).toBe('5 + 3 = ____ Next line & more');
    expect(plainText('<ul><li><p>one</p></li><li><p>two</p></li></ul>')).toBe('one two');
    expect(plainText('H<sub>2</sub>O')).toBe('H2O');
    expect(plainText(null)).toBe('');
    expect(plainText('plain text stays')).toBe('plain text stays');
  });
  it('knows an empty editor from one with a table or an equation', () => {
    expect(isBlankHtml('')).toBe(true);
    expect(isBlankHtml('<div dir="ltr" lang="en" class=""><p></p></div>')).toBe(true);
    expect(isBlankHtml('<p>  </p>')).toBe(true);
    expect(isBlankHtml('<p>word</p>')).toBe(false);
    expect(isBlankHtml('<table><tbody><tr><td></td></tr></tbody></table>')).toBe(false);
    expect(isBlankHtml('<p><span data-type="inlineMath" data-latex="x"></span></p>')).toBe(false);
  });
  it('rejects a question whose editor is empty', () => {
    const f = { ...emptyQuestionForm(), subject: 1, text: '<div dir="ltr" lang="en" class=""><p></p></div>' };
    expect(validateQuestion(f)).toBe('Write the question.');
    expect(validateQuestion({ ...f, text: '<div dir="ltr" lang="en" class=""><p>Q?</p></div>' })).toBeNull();
  });
});

describe('page messages', () => {
  it('reads what the page sends and ignores anything else', () => {
    expect(parsePageMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parsePageMessage('{"type":"change","html":"<p>a</p>","blank":false}')).toEqual({ type: 'change', html: '<p>a</p>', blank: false });
    expect(parsePageMessage('{"type":"state","active":{"bold":true},"language":"ur"}')).toEqual({ type: 'state', active: { bold: true }, language: 'ur' });
    expect(parsePageMessage('{"type":"height","px":212}')).toEqual({ type: 'height', px: 212 });
    expect(parsePageMessage('{"type":"height","px":"x"}')).toBeNull();
    expect(parsePageMessage('not json')).toBeNull();
    expect(parsePageMessage({ type: 'ready' })).toBeNull();
    expect(parsePageMessage('{"type":"other"}')).toBeNull();
  });
  it('builds the messages the page understands', () => {
    expect(JSON.parse(initMessage('<p>x</p>', 'Write'))).toEqual({ type: 'init', html: '<p>x</p>', placeholder: 'Write' });
    expect(JSON.parse(commandMessage('bold'))).toEqual({ type: 'cmd', name: 'bold' });
    expect(JSON.parse(languageMessage('ur'))).toEqual({ type: 'lang', code: 'ur' });
  });
  it('keeps the editor height between its limits', () => {
    expect(clampEditorHeight(10)).toBe(140);
    expect(clampEditorHeight(200.4)).toBe(200);
    expect(clampEditorHeight(2000)).toBe(360);
  });
  it('offers the toolbar commands the page knows', () => {
    expect(TOOLBAR.map((t) => t.name)).toEqual(expect.arrayContaining(['bold', 'italic', 'underline', 'subscript', 'superscript', 'insertTable', 'equation', 'bulletList']));
  });
});

describe('generated editor page', () => {
  it('is present and carries the web editor', () => {
    expect(RICH_EDITOR_HASH).toMatch(/^[0-9a-f]{16}$/);
    expect(RICH_EDITOR_HTML.startsWith('<!doctype html>')).toBe(true);
    expect(RICH_EDITOR_HTML).toContain('id="editor"');
    expect(RICH_EDITOR_HTML.length).toBeGreaterThan(300000);
  });
});
