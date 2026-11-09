// Pure helpers for the lesson plans screen: date presets, stats, grouping and the readable lesson body.
// Mirrors frontend/src/pages/lms/lessonPlanView.js — keep the two in step.

import type { LessonPlan } from './lessonPlans';

export type PresetId = 'today' | 'week' | 'month' | 'last_month' | 'next_month';
export const DATE_PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'next_month', label: 'Next month' },
];

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Local-time ranges; weeks run Monday to Sunday.
export function presetRange(preset: PresetId, today: Date = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  if (preset === 'today') return { from: isoDay(today), to: isoDay(today) };
  if (preset === 'week') {
    const back = (today.getDay() + 6) % 7;
    return { from: isoDay(new Date(y, m, today.getDate() - back)), to: isoDay(new Date(y, m, today.getDate() - back + 6)) };
  }
  const shift = preset === 'last_month' ? -1 : preset === 'next_month' ? 1 : 0;
  return { from: isoDay(new Date(y, m + shift, 1)), to: isoDay(new Date(y, m + shift + 1, 0)) };
}

export function activePreset(from: string, to: string, today: Date = new Date()): PresetId | null {
  return DATE_PRESETS.find((p) => {
    const r = presetRange(p.id, today);
    return r.from === from && r.to === to;
  })?.id ?? null;
}

export interface PlanStats { total: number; published: number; draft: number; teachers: number; subjects: number; classes: number }

export function planStats(plans: LessonPlan[]): PlanStats {
  const teachers = new Set<number>();
  const subjects = new Set<number>();
  const classes = new Set<number>();
  let published = 0;
  for (const p of plans) {
    if (p.status === 'PUBLISHED') published += 1;
    if (p.teacher != null) teachers.add(p.teacher);
    if (p.subject != null) subjects.add(p.subject);
    classes.add(p.session_class ?? p.class_obj);
  }
  return { total: plans.length, published, draft: plans.length - published, teachers: teachers.size, subjects: subjects.size, classes: classes.size };
}

export type GroupMode = 'subject' | 'class' | 'flat';
export interface PlanGroup { key: string; label: string; count: number; published: number; draft: number; plans: LessonPlan[] }
export interface PlanSection extends Omit<PlanGroup, 'plans'> { children: PlanGroup[] }

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, undefined, { numeric: true });
const byDate = (a: LessonPlan, b: LessonPlan) => a.lesson_date.localeCompare(b.lesson_date) || a.id - b.id;
const tally = (plans: LessonPlan[]) => {
  const published = plans.filter((p) => p.status === 'PUBLISHED').length;
  return { count: plans.length, published, draft: plans.length - published };
};

// 'subject' -> Subject > Class > plans;  'class' -> Class > Subject > plans.
export function groupPlans(plans: LessonPlan[], mode: 'subject' | 'class' = 'subject'): PlanSection[] {
  const subjectOf = (p: LessonPlan) => ({ key: `s${p.subject}`, label: p.subject_name || 'No subject' });
  const classOf = (p: LessonPlan) => ({ key: `c${p.session_class ?? p.class_obj}`, label: p.class_name || 'No class' });
  const [outerOf, innerOf] = mode === 'class' ? [classOf, subjectOf] : [subjectOf, classOf];

  const outer = new Map<string, { key: string; label: string; inner: Map<string, { key: string; label: string; plans: LessonPlan[] }> }>();
  for (const p of plans) {
    const o = outerOf(p);
    const i = innerOf(p);
    if (!outer.has(o.key)) outer.set(o.key, { ...o, inner: new Map() });
    const og = outer.get(o.key)!;
    if (!og.inner.has(i.key)) og.inner.set(i.key, { ...i, plans: [] });
    og.inner.get(i.key)!.plans.push(p);
  }
  return [...outer.values()]
    .map((o) => {
      const children: PlanGroup[] = [...o.inner.values()]
        .map((c) => ({ ...c, plans: [...c.plans].sort(byDate), ...tally(c.plans) }))
        .sort(byLabel);
      return { key: o.key, label: o.label, children, ...tally(children.flatMap((c) => c.plans)) };
    })
    .sort(byLabel);
}

const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join('\n');
  return '';
};

// The lesson itself, in reading order. description is only a fallback for display_text, not shown twice.
export function planBodySections(plan: LessonPlan): Array<[string, string]> {
  const topics = [
    ...(plan.planned_topics ?? []).map((t) => (typeof t === 'object' ? t.title || t.name || '' : '')),
    ...(plan.custom_topics ?? []),
  ].filter(Boolean);
  const sections: Array<[string, string]> = [
    ['Lesson', text(plan.display_text) || text(plan.description)],
    ['Topics', topics.join('\n')],
    ['Objectives', text(plan.objectives_text ?? plan.objectives)],
    ['Materials', text(plan.materials_needed)],
    ['Teaching methods', text(plan.teaching_methods)],
  ];
  return sections.filter(([, t]) => t);
}
