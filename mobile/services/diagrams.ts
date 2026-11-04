import { Platform } from 'react-native';

// Figures on a question: the drawing pad (a page built from the web's own drawing code, see
// frontend/src/components/diagramEntry.js) and getting a picture file into the upload form.
// TOOLS, COLORS and WEIGHTS must match frontend/src/components/diagramDraw.js (pinned by __tests__/diagrams.test.ts).

export const TOOLS = [
  { id: 'pen', label: '✎', hint: 'Pen' },
  { id: 'line', label: '╱', hint: 'Straight line' },
  { id: 'rect', label: '▭', hint: 'Rectangle' },
  { id: 'circle', label: '○', hint: 'Circle' },
  { id: 'ellipse', label: '⬭', hint: 'Oval' },
  { id: 'triangle', label: '△', hint: 'Triangle' },
  { id: 'arrow', label: '→', hint: 'Arrow' },
  { id: 'text', label: 'T', hint: 'Text label' },
  { id: 'eraser', label: '⌫', hint: 'Eraser' },
] as const;

export const COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a'] as const;
export const WEIGHTS = [2, 4, 7] as const;

export type PadMessage =
  | { type: 'ready' }
  | { type: 'state'; tool: string; color: string; weight: number; canUndo: boolean; canRedo: boolean; empty: boolean }
  | { type: 'png'; data: string }
  | { type: 'needText' };

export function parsePadMessage(raw: unknown): PadMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const m = JSON.parse(raw);
    if (!m || typeof m !== 'object') return null;
    if (m.type === 'ready') return { type: 'ready' };
    if (m.type === 'needText') return { type: 'needText' };
    if (m.type === 'png' && typeof m.data === 'string') return { type: 'png', data: m.data };
    if (m.type === 'state') {
      return { type: 'state', tool: String(m.tool), color: String(m.color), weight: Number(m.weight), canUndo: !!m.canUndo, canRedo: !!m.canRedo, empty: !!m.empty };
    }
  } catch { /* not ours */ }
  return null;
}

export const padMessage = (type: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type, ...extra });

// "data:image/png;base64,AAAA" -> its parts; null when it is not a base64 data URL.
export function dataUrlParts(dataUrl: string): { mime: string; base64: string } | null {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return m ? { mime: m[1], base64: m[2] } : null;
}

export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export interface PictureFile { uri: string; name: string; mime: string }

// Adds the picture to an upload form. On a phone the form takes {uri, name, type}; in a browser it needs a real File.
export async function appendPicture(form: FormData, field: string, file: PictureFile): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(file.uri)).blob();
    form.append(field, new File([blob], file.name, { type: file.mime }));
  } else {
    form.append(field, { uri: file.uri, name: file.name, type: file.mime } as unknown as Blob);
  }
}

// A drawing from the pad as a file: a data URL in a browser, a temporary PNG on a phone.
export async function drawingToFile(dataUrl: string, slot: string): Promise<PictureFile | null> {
  const parts = dataUrlParts(dataUrl);
  if (!parts) return null;
  const name = `${slot}-drawing.png`;
  if (Platform.OS === 'web') return { uri: dataUrl, name, mime: parts.mime };
  const { File, Paths } = await import('expo-file-system');
  const file = new File(Paths.cache, `${slot}-${Date.now()}.png`);
  file.create({ overwrite: true });
  file.write(base64ToBytes(parts.base64));
  return { uri: file.uri, name, mime: parts.mime };
}
