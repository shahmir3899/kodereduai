import type { NavGroup } from '../navigation/navConfig';
import type { TimetableEntry } from './teacher';
import { listOf } from './academicYear';

// Pure helpers for the Manager screens (read-only academics + content). No React imports so
// Jest can load it.

// by_class answers { grid, entries }; tolerate a bare array too.
export function timetableEntriesOf(data: unknown): TimetableEntry[] {
  const entries = (data as { entries?: unknown } | null | undefined)?.entries;
  return Array.isArray(entries) ? (entries as TimetableEntry[]) : listOf<TimetableEntry>(data);
}

// The nav groups the Academics tab shows; everything else lives in More. Order follows the web.
const ACADEMICS_GROUPS = ['Academics', 'Content Creation', 'Management'];
export function academicsGroups(groups: NavGroup[]): NavGroup[] {
  return ACADEMICS_GROUPS
    .map((name) => groups.find((g) => g.name === name))
    .filter((g): g is NavGroup => !!g);
}

export interface ContentRow {
  id: number;
  title: string;
  subtitle: string;
  pill?: string;
}

const clip = (text: string | undefined | null, max = 90) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const join = (...parts: Array<string | number | null | undefined>) =>
  parts.filter((p) => p !== null && p !== undefined && p !== '').join('  ·  ');

const label = (value?: string | null) =>
  value ? value[0] + value.slice(1).toLowerCase().replace(/_/g, ' ') : '';

export interface QuestionDto {
  id: number; question_text?: string; subject_name?: string; question_type?: string;
  difficulty_level?: string; marks?: number | string;
}
export function questionRow(q: QuestionDto): ContentRow {
  return {
    id: q.id,
    title: clip(q.question_text) || 'Question',
    subtitle: join(q.subject_name, label(q.question_type), q.marks != null ? `${q.marks} marks` : ''),
    pill: label(q.difficulty_level) || undefined,
  };
}

export interface PaperDto {
  id: number; paper_title?: string; class_name?: string; subject_name?: string; exam_name?: string | null;
  status?: string; total_marks?: number | string; question_count?: number;
}
export function paperRow(p: PaperDto): ContentRow {
  return {
    id: p.id,
    title: p.paper_title || 'Untitled paper',
    subtitle: join(p.class_name, p.subject_name, p.total_marks != null ? `${p.total_marks} marks` : '', p.exam_name),
    pill: label(p.status) || undefined,
  };
}

export interface WorksheetDto {
  id: number; title?: string; class_name?: string; subject_name?: string | null; status?: string; item_count?: number;
}
export function worksheetRow(w: WorksheetDto): ContentRow {
  return {
    id: w.id,
    title: w.title || 'Untitled worksheet',
    subtitle: join(w.class_name, w.subject_name, w.item_count != null ? `${w.item_count} items` : ''),
    pill: label(w.status) || undefined,
  };
}

export interface BookDto {
  id: number; title?: string; class_name?: string; subject_name?: string; language?: string;
}
export function bookRow(b: BookDto): ContentRow {
  return { id: b.id, title: b.title || 'Book', subtitle: join(b.class_name, b.subject_name), pill: b.language || undefined };
}

export interface TreeTopic { id: number; title: string; topic_number?: number | string }
export interface TreeChapter { id: number; title: string; chapter_number?: number | string; topics?: TreeTopic[] }

// Book tree answers { chapters: [...] } (or the chapters bare); order by chapter number.
export function chaptersOf(data: unknown): TreeChapter[] {
  const raw = (data as { chapters?: unknown } | null | undefined)?.chapters;
  const list = Array.isArray(raw) ? (raw as TreeChapter[]) : listOf<TreeChapter>(data);
  return [...list].sort((a, b) => Number(a.chapter_number ?? 0) - Number(b.chapter_number ?? 0));
}

export interface CalendarDay {
  date: string; is_off_day?: boolean; off_day_types?: string[];
  events?: Array<{ id: number; name: string }>;
  entries?: Array<{ id: number; name: string; entry_kind?: string; off_day_type?: string }>;
}
export interface CalendarItem { date: string; names: string[]; off: boolean }

// Days of a month worth listing: school events and non-Sunday off days (every Sunday is off, so
// listing them would bury the real entries).
export function calendarItems(days: CalendarDay[]): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const d of days) {
    const names = (d.entries ?? []).map((e) => e.name).filter(Boolean);
    const sundayOnly = (d.off_day_types ?? []).length > 0 && (d.off_day_types ?? []).every((t) => t === 'SUNDAY');
    if (names.length === 0 && (!d.is_off_day || sundayOnly)) continue;
    out.push({ date: d.date, names: names.length ? names : (d.off_day_types ?? []), off: !!d.is_off_day });
  }
  return out;
}

export function monthTitle(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export interface NotificationRecord {
  id: number; title: string; message: string; created_at: string; is_read: boolean; notification_type?: string;
}

// /notifications/my/ answers a page, a { notifications } object or a bare array.
export function notificationsOf(data: unknown): NotificationRecord[] {
  const alt = (data as { notifications?: unknown } | null | undefined)?.notifications;
  return Array.isArray(alt) ? (alt as NotificationRecord[]) : listOf<NotificationRecord>(data);
}
