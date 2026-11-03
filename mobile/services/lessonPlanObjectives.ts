// Pure logic for a lesson plan's objectives: rows with a Bloom level, the conversion to and from the
// plan's plain-text field, and the curriculum suggestions. Port of makeObjectiveRow,
// parseObjectiveTextToRows and objectiveRowsToPlainText in frontend/src/pages/lms/LessonPlansPage.jsx.

export type BloomTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export const BLOOM_LEVELS: Array<{ value: string; label: string }> = [
  { value: 'remember', label: 'Remember' },
  { value: 'understand', label: 'Understand' },
  { value: 'apply', label: 'Apply' },
  { value: 'analyze', label: 'Analyze' },
  { value: 'evaluate', label: 'Evaluate' },
  { value: 'create', label: 'Create' },
];

export const bloomLabel = (v: string | null | undefined): string =>
  BLOOM_LEVELS.find((b) => b.value === v)?.label ?? (v ? v[0].toUpperCase() + v.slice(1) : '');

// Same ladder as the web badge colours: grey, blue, green, amber, then red for the two top levels.
export function bloomTone(v: string | null | undefined): BloomTone {
  switch (v) {
    case 'understand': return 'info';
    case 'apply': return 'success';
    case 'analyze': return 'warning';
    case 'evaluate':
    case 'create': return 'error';
    default: return 'neutral';
  }
}

export interface ObjectiveRow {
  key: string;
  // Set while the row is exactly a curriculum objective; editing the words makes it the teacher's own.
  objectiveId: number | null;
  statement: string;
  bloom: string;
}

export interface LinkedObjective { id: number; statement: string; bloom_level?: string | null }

let counter = 0;
export function newRow(seed: { objectiveId?: number | null; statement?: string; bloom?: string | null } = {}): ObjectiveRow {
  counter += 1;
  return { key: `obj-${counter}`, objectiveId: seed.objectiveId ?? null, statement: seed.statement ?? '', bloom: seed.bloom ?? '' };
}

// The server and the AI sometimes send a list or an object where text is expected.
export function plainText(val: unknown): string {
  if (val == null || val === '') return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return val.map(plainText).filter(Boolean).join('\n').trim();
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    const inner = o.text ?? o.content ?? o.description ?? o.body ?? o.title;
    return inner !== undefined && inner !== val ? plainText(inner) : '';
  }
  return String(val).trim();
}

// One row per line, with list marks ("-", "*", "1.") stripped.
export function rowsFromText(raw: unknown): ObjectiveRow[] {
  const text = plainText(raw);
  if (!text) return [];
  return text.split('\n').map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean).map((statement) => newRow({ statement }));
}

// Linked curriculum objectives keep their Bloom level; otherwise the plan's text is split into rows.
// A plan with neither gets one empty row to type into.
export function rowsFromPlan(plan: { linked_objectives?: LinkedObjective[] | null; objectives?: unknown; objectives_text?: unknown }): ObjectiveRow[] {
  const linked = (plan.linked_objectives ?? []).map((o) => newRow({ objectiveId: o.id, statement: o.statement, bloom: o.bloom_level }));
  if (linked.length > 0) return linked;
  const parsed = rowsFromText(plan.objectives_text ?? plan.objectives);
  return parsed.length > 0 ? parsed : [newRow()];
}

export function rowsToText(rows: ObjectiveRow[]): string {
  return rows.map((r) => r.statement.trim()).filter(Boolean).map((s) => `- ${s}`).join('\n');
}

// Curriculum objectives still attached to a row, each once.
export function linkIdsOf(rows: ObjectiveRow[]): number[] {
  return [...new Set(rows.filter((r) => r.statement.trim() && Number.isInteger(r.objectiveId)).map((r) => r.objectiveId as number))];
}

export function editRow(rows: ObjectiveRow[], key: string, patch: { statement?: string; bloom?: string }): ObjectiveRow[] {
  return rows.map((r) => {
    if (r.key !== key) return r;
    // New words are no longer the curriculum's objective, so the link is dropped (as on the web).
    return { ...r, ...patch, ...(patch.statement !== undefined && patch.statement !== r.statement ? { objectiveId: null } : {}) };
  });
}

// Removing the last row leaves one empty row, so there is always somewhere to type.
export function removeRow(rows: ObjectiveRow[], key: string): ObjectiveRow[] {
  const next = rows.filter((r) => r.key !== key);
  return next.length > 0 ? next : [newRow()];
}

// Adds a curriculum objective in place of a trailing empty row; one already added is not added twice.
export function addSuggestion(rows: ObjectiveRow[], o: LinkedObjective): ObjectiveRow[] {
  if (rows.some((r) => r.objectiveId === o.id)) return rows;
  const base = rows.length > 0 && !rows[rows.length - 1].statement.trim() ? rows.slice(0, -1) : rows;
  return [...base, newRow({ objectiveId: o.id, statement: o.statement, bloom: o.bloom_level })];
}

// Objectives of several topics as one list: each once, and none already on the plan.
export function suggestionsFor(lists: LinkedObjective[][], rows: ObjectiveRow[], limit = 12): LinkedObjective[] {
  const taken = new Set(rows.map((r) => r.objectiveId).filter((id) => id != null));
  const seen = new Set<number>();
  const out: LinkedObjective[] = [];
  for (const list of lists) {
    for (const o of list) {
      if (seen.has(o.id) || taken.has(o.id)) continue;
      seen.add(o.id);
      out.push(o);
    }
  }
  return out.slice(0, limit);
}

// Under a plan's title: its first two objectives, then how many more.
export function objectiveSummary(objectives: LinkedObjective[] | null | undefined): { shown: LinkedObjective[]; more: number } {
  const all = objectives ?? [];
  return { shown: all.slice(0, 2), more: Math.max(0, all.length - 2) };
}
