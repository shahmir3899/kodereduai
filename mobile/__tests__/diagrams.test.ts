import fs from 'fs';
import path from 'path';
import { base64ToBytes, COLORS, dataUrlParts, padMessage, parsePadMessage, TOOLS, WEIGHTS } from '../services/diagrams';
import { DIAGRAM_PAD_HASH, DIAGRAM_PAD_HTML } from '../assets/diagramPadHtml';
import { hasPicture, PICTURE_SLOTS, slotsFor } from '../services/questionBank';

// The tools, colours and weights must be the web canvas's own (frontend/src/components/diagramDraw.js).
const web = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/diagramDraw.js'), 'utf8');
const webList = (name: string) => JSON.parse(new RegExp(`${name} = (\\[[^\\]]*\\])`).exec(web)![1].replace(/'/g, '"'));

describe('drawing pad constants (same as web)', () => {
  it('offers the web tools in the web order', () => { expect(TOOLS.map((t) => t.id)).toEqual(webList('TOOL_IDS')); });
  it('uses the web colours and line weights', () => {
    expect([...COLORS]).toEqual(webList('COLORS'));
    expect([...WEIGHTS]).toEqual(webList('WEIGHTS'));
  });
});

describe('pad messages', () => {
  it('reads what the page sends and ignores anything else', () => {
    expect(parsePadMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parsePadMessage('{"type":"needText"}')).toEqual({ type: 'needText' });
    expect(parsePadMessage('{"type":"png","data":"data:image/png;base64,QUJD"}')).toEqual({ type: 'png', data: 'data:image/png;base64,QUJD' });
    expect(parsePadMessage('{"type":"state","tool":"line","color":"#111827","weight":4,"canUndo":true,"canRedo":false,"empty":false}'))
      .toEqual({ type: 'state', tool: 'line', color: '#111827', weight: 4, canUndo: true, canRedo: false, empty: false });
    expect(parsePadMessage('{"type":"png"}')).toBeNull();
    expect(parsePadMessage('nope')).toBeNull();
    expect(parsePadMessage({ type: 'ready' })).toBeNull();
  });
  it('builds the messages the page understands', () => {
    expect(JSON.parse(padMessage('tool', { id: 'arrow' }))).toEqual({ type: 'tool', id: 'arrow' });
    expect(JSON.parse(padMessage('export'))).toEqual({ type: 'export' });
  });
});

describe('drawings as files', () => {
  it('splits a PNG data URL and rejects anything else', () => {
    expect(dataUrlParts('data:image/png;base64,QUJD')).toEqual({ mime: 'image/png', base64: 'QUJD' });
    expect(dataUrlParts('data:text/plain,hello')).toBeNull();
    expect(dataUrlParts('https://example.com/a.png')).toBeNull();
  });
  it('decodes base64 to bytes', () => {
    expect(Array.from(base64ToBytes('QUJD'))).toEqual([65, 66, 67]);
    expect(base64ToBytes('').length).toBe(0);
  });
});

describe('picture slots and the generated pad page', () => {
  it('offers option pictures only on multiple choice, and every slot has a field', () => {
    expect(slotsFor('MCQ').map((s) => s.slot)).toEqual(['question', 'option_a', 'option_b', 'option_c', 'option_d', 'answer']);
    expect(slotsFor('SHORT').map((s) => s.slot)).toEqual(['question', 'answer']);
    expect(PICTURE_SLOTS.every((s) => String(s.field).endsWith('_image_url'))).toBe(true);
  });
  it('knows which slot already has a picture', () => {
    const q = { id: 1, subject: 1, question_text: 'Q', question_type: 'MCQ', difficulty_level: 'EASY', marks: 1, option_b_image_url: 'https://x/b.png' };
    expect(hasPicture(q, 'option_b')).toBe(true);
    expect(hasPicture(q, 'option_a')).toBe(false);
    expect(hasPicture(null, 'question')).toBe(false);
  });
  it('is present and has a canvas', () => {
    expect(DIAGRAM_PAD_HASH).toMatch(/^[0-9a-f]{16}$/);
    expect(DIAGRAM_PAD_HTML).toContain('<canvas id="pad">');
  });
});
