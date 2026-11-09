import { routeFor } from '../navigation/routes';
import type { Persona } from '../navigation/personas';

// Mirrors frontend/src/components/notifications/notificationMeta.js. Keep the two in step: the
// phone and the web inbox must label, group and route the same event the same way. No React
// Native imports, so Jest can load it.

export interface NotificationRecord {
  id: number;
  title: string;
  // The API calls this `body`; kept as `message` for older callers.
  message: string;
  created_at: string;
  is_read: boolean;
  event_type: string;
  school?: number | null;
  school_name?: string | null;
  student?: number | null;
  student_name?: string | null;
}

export interface NotificationBundle {
  bundle: true;
  id: string;
  event_type: string;
  school?: number | null;
  school_name?: string | null;
  created_at: string;
  is_read: boolean;
  count: number;
  title: string;
  total: number | null;
  children: NotificationRecord[];
}

export type NotificationEntry = NotificationRecord | NotificationBundle;

export const isBundle = (n: NotificationEntry): n is NotificationBundle => (n as NotificationBundle).bundle === true;

// The server sends `body` / `event_type`; the older phone code read `message` / `notification_type`,
// which is why bodies were blank and every icon was a bell.
export function normalizeNotification(raw: unknown): NotificationRecord {
  const r = (raw ?? {}) as Record<string, unknown>;
  const body = r.body ?? r.message ?? '';
  return {
    id: Number(r.id),
    title: String(r.title ?? ''),
    message: String(body),
    created_at: String(r.created_at ?? ''),
    is_read: Boolean(r.is_read) || r.status === 'READ' || Boolean(r.read_at),
    event_type: String(r.event_type ?? r.notification_type ?? 'GENERAL').toUpperCase(),
    school: (r.school as number | null | undefined) ?? null,
    school_name: (r.school_name as string | null | undefined) ?? null,
    student: (r.student as number | null | undefined) ?? null,
    student_name: (r.student_name as string | null | undefined) ?? null,
  };
}

export type Tone = 'red' | 'amber' | 'green' | 'indigo' | 'teal' | 'violet' | 'slate';

export const TONES: Record<Tone, { bg: string; fg: string }> = {
  red: { bg: '#fef2f2', fg: '#b91c1c' },
  amber: { bg: '#fffbeb', fg: '#92400e' },
  green: { bg: '#ecfdf5', fg: '#047857' },
  indigo: { bg: '#eef2ff', fg: '#4338ca' },
  teal: { bg: '#f0fdfa', fg: '#0f766e' },
  violet: { bg: '#f5f3ff', fg: '#6d28d9' },
  slate: { bg: '#f1f5f9', fg: '#334155' },
};

export interface EventMeta { label: string; plural: string; icon: string; tone: Tone }

// Ionicons names; mirrors NotificationTemplate.EVENT_TYPE_CHOICES in the backend.
export const EVENT_META: Record<string, EventMeta> = {
  ABSENCE: { label: 'Absence', plural: 'absence alerts', icon: 'person-remove-outline', tone: 'red' },
  ATTENDANCE_RISK: { label: 'Attendance risk', plural: 'attendance risk alerts', icon: 'warning-outline', tone: 'red' },
  FEE_DUE: { label: 'Fee due', plural: 'fee reminders', icon: 'cash-outline', tone: 'amber' },
  FEE_OVERDUE: { label: 'Fee overdue', plural: 'overdue fees', icon: 'cash-outline', tone: 'red' },
  EXAM_RESULT: { label: 'Result', plural: 'results', icon: 'ribbon-outline', tone: 'green' },
  EXAM_SCHEDULE: { label: 'Exam schedule', plural: 'exam schedule updates', icon: 'calendar-outline', tone: 'indigo' },
  ASSIGNMENT_DUE: { label: 'Assignment', plural: 'assignments due', icon: 'book-outline', tone: 'indigo' },
  TRANSPORT_UPDATE: { label: 'Transport', plural: 'transport updates', icon: 'bus-outline', tone: 'teal' },
  LIBRARY_OVERDUE: { label: 'Library', plural: 'library reminders', icon: 'library-outline', tone: 'violet' },
  LEAVE_DECISION: { label: 'Leave', plural: 'leave updates', icon: 'document-text-outline', tone: 'green' },
  GENERAL: { label: 'Announcement', plural: 'announcements', icon: 'megaphone-outline', tone: 'slate' },
  CUSTOM: { label: 'Message', plural: 'messages', icon: 'chatbubble-outline', tone: 'slate' },
};

export const EVENT_TYPE_OPTIONS = Object.entries(EVENT_META).map(([value, m]) => ({ value, label: m.label }));

export function getEventMeta(type?: string): EventMeta {
  return (type && EVENT_META[type]) || { label: type || 'Notification', plural: 'notifications', icon: 'notifications-outline', tone: 'slate' };
}

// Colour stripe per school, derived from the id so the same school is the same colour on web and phone.
const SCHOOL_COLORS = ['#0d9488', '#a855f7', '#f59e0b', '#2563eb', '#e11d48', '#65a30d', '#0891b2', '#c026d3'];
export const NEUTRAL_STRIPE = '#cbd5e1';

export function schoolColor(schoolId: unknown): string {
  const n = Number(schoolId);
  if (!Number.isFinite(n)) return NEUTRAL_STRIPE;
  return SCHOOL_COLORS[Math.abs(n) % SCHOOL_COLORS.length];
}

export function timeAgo(dateStr?: string, now: number = Date.now()): string {
  if (!dateStr) return '';
  const mins = Math.floor((now - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function initials(name?: string | null): string {
  if (!name) return '';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export const BUNDLE_MIN_SIZE = 3;
// A bundle lists this many members inline; the rest sit behind "Show all".
export const BUNDLE_PREVIEW = 3;
// Long bodies fold after a few lines but never lose text.
export const FOLD_CHARS = 160;

const AMOUNT_RE = /Rs\.?\s*([\d,]+(?:\.\d+)?)/i;

export function parseAmount(text?: string): number | null {
  const m = AMOUNT_RE.exec(text || '');
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

// Sum of a fee bundle, or null if any member has no amount (a partial total would mislead).
function feeTotal(group: NotificationRecord[]): number | null {
  if (!['FEE_DUE', 'FEE_OVERDUE'].includes(group[0].event_type)) return null;
  const amounts = group.map((g) => parseAmount(g.message));
  return amounts.every((a) => a !== null) ? (amounts as number[]).reduce((x, y) => x + y, 0) : null;
}

const groupKey = (n: NotificationRecord) => {
  const d = new Date(n.created_at);
  return `${n.event_type}|${n.school}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

// Same type, same school, same calendar day -> one card, so 12 absence alerts aren't 12 rows.
// A bundle takes the place of its first member.
export function bundleNotifications(items: NotificationRecord[], minSize = BUNDLE_MIN_SIZE): NotificationEntry[] {
  const groups = new Map<string, NotificationRecord[]>();
  items.forEach((n) => {
    const key = groupKey(n);
    const list = groups.get(key);
    if (list) list.push(n); else groups.set(key, [n]);
  });

  const emitted = new Set<string>();
  const out: NotificationEntry[] = [];
  items.forEach((n) => {
    const key = groupKey(n);
    const group = groups.get(key) as NotificationRecord[];
    if (group.length < minSize) { out.push(n); return; }
    if (emitted.has(key)) return;
    emitted.add(key);
    out.push({
      id: `bundle-${key}`,
      bundle: true,
      event_type: n.event_type,
      school: n.school,
      school_name: n.school_name,
      created_at: group.reduce((a, g) => (new Date(g.created_at) > new Date(a) ? g.created_at : a), group[0].created_at),
      is_read: group.every((g) => g.is_read),
      count: group.length,
      title: `${group.length} ${getEventMeta(n.event_type).plural}`,
      total: feeTotal(group),
      children: group,
    });
  });
  return out;
}

export interface DayGroup { label: string; items: NotificationEntry[] }

export function groupByDay(items: NotificationEntry[], now: Date = new Date()): DayGroup[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  const buckets: DayGroup[] = [{ label: 'Today', items: [] }, { label: 'Yesterday', items: [] }, { label: 'Earlier', items: [] }];
  items.forEach((n) => {
    const age = startOfToday.getTime() - new Date(n.created_at).getTime();
    buckets[age < 0 ? 0 : age < dayMs ? 1 : 2].items.push(n);
  });
  return buckets.filter((b) => b.items.length > 0);
}

// Where tapping a notification goes: the web destination for the role (same table as the web's
// getNotificationPath), turned into a phone route. null when the phone has no such screen.
export function notificationDestination(n: NotificationRecord, persona: Persona): string | null {
  const type = n.event_type;
  const web = (path: string) => routeFor(persona, path) ?? null;
  if (persona === 'parent') {
    if (type === 'LEAVE_DECISION') return web('/parent/leave');
    if ((type === 'ABSENCE' || type === 'ATTENDANCE_RISK') && n.student) return `/(parent)/children/${n.student}/attendance`;
    return null;
  }
  if (persona === 'student') {
    const map: Record<string, string> = {
      ABSENCE: '/student/attendance', ATTENDANCE_RISK: '/student/attendance',
      FEE_DUE: '/student/fees', FEE_OVERDUE: '/student/fees',
      EXAM_RESULT: '/student/results', EXAM_SCHEDULE: '/student/exam-schedule',
      ASSIGNMENT_DUE: '/student/assignments', LIBRARY_OVERDUE: '/student/library',
      TRANSPORT_UPDATE: '/student/transport',
    };
    return map[type] ? web(map[type]) : null;
  }
  if (persona === 'driver') return null;
  const map: Record<string, string> = {
    ABSENCE: '/attendance', ATTENDANCE_RISK: '/attendance/at-risk',
    FEE_DUE: '/finance/fees', FEE_OVERDUE: '/finance/fees',
    EXAM_RESULT: '/academics/results', EXAM_SCHEDULE: '/academics/exam-schedule',
    ASSIGNMENT_DUE: '/academics/assignments', LIBRARY_OVERDUE: '/library/overdue',
    TRANSPORT_UPDATE: '/transport', LEAVE_DECISION: '/hr/leave',
  };
  return map[type] ? web(map[type]) : null;
}
