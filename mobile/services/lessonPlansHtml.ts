import { plainText } from './lessonPlanObjectives';
import { esc } from './reportCardHtml';

// The lesson plans PDF as an HTML page, drawn on the phone from the same list the screen loads;
// expo-print turns it into the PDF. Same content and order as the web export
// (frontend/src/pages/lms/lessonPlansExportPdf.js): a cover, then each class and subject with plans
// that have no detail as one compact table and the others as full cards, in date order. Urdu and
// Arabic text is shaped by the phone's own web view (`dir="auto"`), so it needs no special drawing.
// Pure: no React and no native modules, so it is unit-tested.

export interface ExportPlan {
  id: number;
  title?: string;
  lesson_date?: string | null;
  duration_minutes?: number | null;
  status?: string;
  class_obj?: number;
  class_name?: string;
  subject?: number;
  subject_name?: string;
  teacher_name?: string;
  description?: unknown;
  objectives?: unknown;
  objectives_text?: unknown;
  teaching_methods?: unknown;
  materials_needed?: unknown;
  display_text?: unknown;
  custom_topics?: string[];
  planned_topics?: Array<number | { id?: number; title?: string; chapter?: number | null }>;
  planned_subtopics?: Array<number | { id?: number; title?: string }>;
  ai_generated?: boolean;
}

export interface ExportSchool { name?: string | null; logo?: string | null }

// A phone has little memory for a PDF; past this many plans the range should be narrowed.
export const EXPORT_MAX_PLANS = 300;

const INK = '#4f46e5';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function formatLessonDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Both ends are needed for a document that says which dates it covers, as on the web.
export function exportRangeProblem(from: string, to: string): string | null {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return 'Choose both lesson dates to download the PDF.';
  if (from > to) return 'From must not be after To.';
  return null;
}

export const exportCountProblem = (count: number): string | null =>
  count === 0 ? 'No lesson plans match these filters.' : count > EXPORT_MAX_PLANS ? `That is more than ${EXPORT_MAX_PLANS} lesson plans. Narrow the dates, class or subject.` : null;

// Oldest lesson first, as the web export lists them.
export const sortByDate = (plans: ExportPlan[]): ExportPlan[] =>
  [...plans].sort((a, b) => String(a.lesson_date ?? '').localeCompare(String(b.lesson_date ?? '')) || a.id - b.id);

// A plan is "minimal" when none of its free-text detail fields has content.
export function isMinimalPlan(p: ExportPlan): boolean {
  return !plainText(p.description) && !plainText(p.objectives_text ?? p.objectives) && !plainText(p.teaching_methods) && !plainText(p.materials_needed);
}

export interface PlanGroup { className: string; subjectName: string; plans: ExportPlan[] }

// By class then subject (alphabetical), keeping date order inside each group.
export function groupPlans(plans: ExportPlan[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const p of plans) {
    const key = `${p.class_obj ?? p.class_name ?? ''}::${p.subject ?? p.subject_name ?? ''}`;
    if (!groups.has(key)) groups.set(key, { className: p.class_name?.trim() || 'Unknown class', subjectName: p.subject_name?.trim() || 'Unknown subject', plans: [] });
    groups.get(key)!.plans.push(p);
  }
  return [...groups.values()].sort((a, b) => a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName));
}

// Runs of consecutive minimal or detailed plans, in the original order.
export function splitRuns(plans: ExportPlan[]): Array<{ minimal: boolean; plans: ExportPlan[] }> {
  const runs: Array<{ minimal: boolean; plans: ExportPlan[] }> = [];
  for (const p of plans) {
    const minimal = isMinimalPlan(p);
    const last = runs[runs.length - 1];
    if (last && last.minimal === minimal) last.plans.push(p);
    else runs.push({ minimal, plans: [p] });
  }
  return runs;
}

// The title, plus any custom topic the title does not already name.
export function topicCell(p: ExportPlan): string {
  const base = p.title?.trim() || plainText(p.display_text) || 'Untitled';
  const custom = (p.custom_topics ?? []).map((t) => String(t || '').trim()).filter(Boolean);
  return custom.length === 0 || custom.every((t) => base.includes(t)) ? base : `${base}\n${custom.join(', ')}`;
}

const slug = (s: string) => s.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
function segment(plans: ExportPlan[], field: 'class_name' | 'subject_name', fallback: string): string {
  const values = [...new Set(plans.map((p) => (p[field] || '').trim()).filter(Boolean))];
  if (values.length === 0) return fallback;
  return values.length === 1 ? slug(values[0]) : `multiple-${field === 'class_name' ? 'classes' : 'subjects'}`;
}

export function lessonPlansFileName(plans: ExportPlan[], from: string, to: string): string {
  return `lesson-plans_${segment(plans, 'class_name', 'all-classes')}_${segment(plans, 'subject_name', 'all-subjects')}_${from}_${to}.pdf`;
}

const text = (v: unknown) => esc(v);
const block = (v: unknown) => `<div class="txt" dir="auto">${esc(v)}</div>`;

function section(heading: string, raw: unknown): string {
  const t = plainText(raw);
  return `<div class="sec"><h4>${esc(heading)}</h4>${block(t || '—')}</div>`;
}

function bullets(items: string[]): string {
  return items.map((i) => `• ${i}`).join('\n');
}

function compactTable(plans: ExportPlan[], showTeacher: boolean): string {
  const head = ['Date', 'Lesson / Topic', ...(showTeacher ? ['Teacher'] : []), 'Duration', 'Status', 'AI'];
  const rows = plans.map((p) => `<tr>
    <td class="nw">${text(formatLessonDate(p.lesson_date))}</td>
    <td dir="auto" class="pre">${text(topicCell(p))}</td>
    ${showTeacher ? `<td dir="auto">${text(p.teacher_name || '—')}</td>` : ''}
    <td class="nw">${p.duration_minutes != null ? `${text(p.duration_minutes)} min` : '—'}</td>
    <td class="nw">${text(p.status || '—')}</td>
    <td class="c">${p.ai_generated ? 'AI' : '—'}</td>
  </tr>`).join('');
  return `<table class="grid"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function card(p: ExportPlan): string {
  const meta: Array<[string, string]> = [
    ['Class', p.class_name || '—'], ['Subject', p.subject_name || '—'], ['Teacher', p.teacher_name || '—'],
    ['Duration', p.duration_minutes != null ? `${p.duration_minutes} min` : '—'], ['Status', String(p.status || '—')],
    ...(p.ai_generated ? [['Source', 'AI-generated'] as [string, string]] : []),
  ];
  const topics = (p.planned_topics ?? []).filter((t): t is { id?: number; title?: string; chapter?: number | null } => typeof t === 'object')
    .map((t) => `${t.title || 'Topic'}${t.chapter != null ? ` (Ch. ${t.chapter})` : ''}`);
  const subtopics = (p.planned_subtopics ?? []).filter((t): t is { id?: number; title?: string } => typeof t === 'object')
    .map((t) => t.title?.trim() || `Sub-topic #${t.id ?? '?'}`);
  const custom = (p.custom_topics ?? []).filter(Boolean);
  return `<div class="card">
    <div class="bar2" dir="auto">${text(formatLessonDate(p.lesson_date))} &nbsp;·&nbsp; ${text(p.title?.trim() || 'Untitled')}</div>
    <table class="meta">${meta.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td dir="auto">${text(v)}</td></tr>`).join('')}</table>
    ${section('Description', p.description)}
    ${section('Objectives', p.objectives_text ?? p.objectives)}
    ${section('Teaching methods', p.teaching_methods)}
    ${section('Materials needed', p.materials_needed)}
    ${plainText(p.display_text) ? section('Curriculum / topic summary', p.display_text) : ''}
    ${topics.length ? section('Planned topics', bullets(topics)) : ''}
    ${subtopics.length ? section('Planned sub-topics', bullets(subtopics)) : ''}
    ${custom.length ? section('Custom topics', bullets(custom)) : ''}
  </div>`;
}

const CSS = `
  @page { margin: 14mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #212121; font-size: 9pt; margin: 0; }
  .logo { display: block; margin: 0 auto 4mm; height: 16mm; }
  .school { text-align: center; color: ${INK}; font-weight: 700; font-size: 11pt; margin-bottom: 3mm; }
  .bar { background: ${INK}; color: #fff; text-align: center; font-weight: 700; font-size: 14pt; padding: 2.5mm 0; margin: 0 0 5mm; }
  .line { font-size: 10pt; margin: 0 0 2mm; }
  .count { font-size: 9pt; color: #5a5a5a; margin: 0 0 4mm; }
  hr { border: 0; border-top: 0.5mm solid ${INK}; margin: 0 0 5mm; }
  h2 { color: ${INK}; font-size: 12pt; margin: 6mm 0 1mm; border-bottom: 0.3mm solid ${INK}; padding-bottom: 1mm; page-break-after: avoid; }
  .teacher { color: #5a5a5a; font-size: 9pt; margin: 1mm 0 3mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
  .grid th { background: ${INK}; color: #fff; text-align: left; font-size: 9pt; padding: 2.5mm; }
  .grid td { border: 0.1mm solid #dcdcdc; padding: 2.2mm; font-size: 8.5pt; vertical-align: top; }
  .grid tr:nth-child(even) td { background: #f8f8fc; }
  .grid tr { page-break-inside: avoid; }
  .nw { white-space: nowrap; } .c { text-align: center; } .pre { white-space: pre-wrap; }
  .card { margin: 4mm 0 6mm; page-break-inside: auto; }
  .bar2 { background: ${INK}; color: #fff; font-weight: 700; font-size: 10pt; padding: 2.5mm 3mm; page-break-after: avoid; }
  .meta td { padding: 1.5mm 2.5mm; font-size: 9pt; border-bottom: 0.1mm solid #dcdcdc; }
  .meta .k { width: 42mm; font-weight: 700; color: #555; }
  .sec { margin: 0 0 3mm; page-break-inside: avoid; }
  .sec h4 { margin: 0 0 1.5mm; font-size: 10pt; color: #373737; }
  .txt { white-space: pre-wrap; font-size: 9pt; color: #232323; line-height: 1.45; }
  .foot { margin-top: 8mm; color: #828282; font-size: 8pt; border-top: 0.2mm solid #dcdcdc; padding-top: 2mm; }
`;

export function renderLessonPlansHtml(input: {
  plans: ExportPlan[]; from: string; to: string; yearLabel?: string | null; school?: ExportSchool | null; generatedAt: string;
}): string {
  const { plans, from, to, yearLabel, school, generatedAt } = input;
  const groups = groupPlans(plans);
  const body = groups.map((g) => {
    const teachers = [...new Set(g.plans.map((p) => (p.teacher_name || '').trim()).filter(Boolean))];
    const constantTeacher = teachers.length === 1 ? teachers[0] : null;
    const runs = splitRuns(g.plans).map((r) => (r.minimal ? compactTable(r.plans, !constantTeacher) : r.plans.map(card).join(''))).join('');
    return `<h2 dir="auto">${text(g.className)} — ${text(g.subjectName)}</h2>${constantTeacher ? `<div class="teacher" dir="auto">Teacher: ${text(constantTeacher)}</div>` : ''}${runs}`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head><body>
    ${school?.logo ? `<img class="logo" src="${esc(school.logo)}" />` : ''}
    ${school?.name?.trim() ? `<div class="school" dir="auto">${text(school.name.trim())}</div>` : ''}
    <div class="bar">Lesson plans</div>
    ${yearLabel ? `<div class="line">Academic year: ${text(yearLabel)}</div>` : ''}
    <div class="line">Lesson dates: ${text(formatLessonDate(from))} to ${text(formatLessonDate(to))}</div>
    <div class="count">Plans included: ${plans.length}</div>
    <hr />
    ${body}
    <div class="foot">Generated: ${text(generatedAt)}</div>
  </body></html>`;
}
