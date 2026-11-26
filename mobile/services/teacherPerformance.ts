// Pure helpers for the teacher performance report (server: backend/hr/performance; web:
// frontend/src/pages/hr/teacherPerformance/shared.js). No React or native imports, so Jest covers them.

import type { Tone } from '../components/ui/StatusPill';
import { monthLong } from './dates';

export interface Band { key: string; label: string }
export interface MissedItem {
  date?: string; section?: string; lesson?: string; exam?: string; assignment?: string;
  class_subject?: string; student?: string; reason?: string;
}
export interface Measure {
  key: string; label: string; applicable: boolean; score: number | null; weight: number;
  effective_weight: number; due: number; done: number; on_time: number; missed?: MissedItem[];
}
export interface Win { key: string; label: string; points_available: number }
export interface PerformanceInfo {
  syllabus_on_schedule?: { planned: number; taught_on_time: number };
  questions_added?: number;
  class_result_average?: number | null;
  marks_counted?: number;
  leave_days?: number;
}
export interface TeacherResult {
  staff_id: number; name: string; employee_id?: string; overall_score: number | null; rank: number | null;
  band: Band | null; quickest_wins: Win[]; measures: Record<string, Measure>; info?: PerformanceInfo;
}
export interface Period { start: string; end: string; counted_until: string }
export interface ReportResponse {
  period: Period; out_of: number | null; teachers: TeacherResult[]; snapshot?: boolean; frozen_at?: string;
}
export interface TeacherResponse {
  period: Period; out_of: number | null; teacher: TeacherResult; snapshot?: boolean; frozen_at?: string;
  enabled?: boolean;
}
export interface Explainer {
  general: string[];
  measures: { key: string; label: string; weight: number; rule: string }[];
  bands: { key: string; label: string; min: number }[];
}

export const MEASURE_ORDER = [
  'attendance_marking', 'lesson_plans', 'marks_entry', 'own_attendance', 'homework',
  'grading', 'messages_answered', 'question_papers', 'book_content', 'login_days',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar month `offset` months from the given date (0 = this month), as start/end dates. */
export function monthRange(offset = 0, today: Date = new Date()): { start: string; end: string; label: string } {
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const label = monthLong(first);
  return { start: iso(first), end: iso(last), label };
}

const BAND_TONE: Record<string, Tone> = { EXCELLENT: 'success', GOOD: 'info', FAIR: 'warning', NEEDS_ATTENTION: 'error' };

export function bandTone(band: Band | null | undefined): Tone {
  return (band && BAND_TONE[band.key]) || 'neutral';
}

export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined ? '—' : Number(score).toFixed(1);
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** "5th of 22", or '' when the school hides positions (rank or out_of is null). */
export function positionText(rank: number | null | undefined, outOf: number | null | undefined): string {
  return rank && outOf ? `${ordinal(rank)} of ${outOf}` : '';
}

export function orderedMeasures(measures: Record<string, Measure> | undefined): Measure[] {
  return MEASURE_ORDER.map((k) => measures?.[k]).filter((m): m is Measure => !!m);
}

export function describeMissed(item: MissedItem): string {
  const what = item.section || item.lesson || item.exam || item.assignment || item.class_subject || '';
  const who = item.student ? ` (${item.student})` : '';
  return [item.date, what && `${what}${who}`, item.reason].filter(Boolean).join(' · ');
}

/** Bar colour by score: same thresholds as the web detail view. */
export function scoreLevel(score: number | null): 'good' | 'mid' | 'low' {
  if (score === null) return 'low';
  return score >= 75 ? 'good' : score >= 60 ? 'mid' : 'low';
}

export function infoRows(info: PerformanceInfo | undefined): { label: string; value: string }[] {
  if (!info) return [];
  const rows: { label: string; value: string }[] = [];
  const s = info.syllabus_on_schedule;
  if (s && s.planned) rows.push({ label: 'Syllabus topics taught on schedule', value: `${s.taught_on_time} of ${s.planned}` });
  if (info.class_result_average !== null && info.class_result_average !== undefined) {
    rows.push({ label: 'Class result average', value: `${info.class_result_average}% (${info.marks_counted ?? 0} marks)` });
  }
  if (info.questions_added !== undefined) rows.push({ label: 'Questions added to the bank', value: String(info.questions_added) });
  if (info.leave_days !== undefined) rows.push({ label: 'Approved leave (working days)', value: String(info.leave_days) });
  return rows;
}

export function exportFileName(start: string, end: string, kind: 'pdf' | 'xlsx'): string {
  return `teacher-performance-${start}-to-${end}.${kind}`;
}
