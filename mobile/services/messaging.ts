// Pure helpers for the staff Messages screens (/api/messaging/). No React imports.

export interface Thread {
  id: string;
  subject?: string;
  latest_message?: string | null;
  latest_message_at?: string | null;
  unread_count?: number;
  other_participant_name?: string;
  other_participant_role?: string;
  student_name?: string | null;
  created_at?: string;
}

export interface ThreadMessage {
  id: number | string;
  body: string;
  sender_name: string;
  is_mine: boolean;
  created_at: string;
}

export interface ThreadDetail extends Thread {
  messages: ThreadMessage[];
}

export interface Recipient {
  id: number;
  name: string;
  role?: string;
  department?: string | null;
  // A parent's recipients are teachers listed once per child.
  student_id?: number | null;
  student_name?: string | null;
  class_name?: string | null;
}

// A recipient can repeat across children, so the picker value pairs the person with the child.
export const recipientKey = (r: Pick<Recipient, 'id' | 'student_id'>) => `${r.id}:${r.student_id ?? ''}`;

export function recipientLabel(r: Recipient): string {
  const who = r.role ? `${r.name} (${roleLabel(r.role)})` : r.name;
  return r.student_name ? `${who} — ${r.student_name}` : who;
}

// Newest activity first; a thread with no message yet sorts by its creation time.
export function sortThreads(threads: Thread[]): Thread[] {
  const when = (t: Thread) => Date.parse(t.latest_message_at || t.created_at || '') || 0;
  return [...threads].sort((a, b) => when(b) - when(a));
}

export function totalUnread(threads: Thread[]): number {
  return threads.reduce((sum, t) => sum + (t.unread_count ?? 0), 0);
}

export function threadTitle(t: Thread): string {
  return t.other_participant_name || t.subject || 'Conversation';
}

export function roleLabel(role?: string): string {
  if (!role) return '';
  return role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// '5m', '3h', '2d', else the date. `now` is injected so tests are deterministic.
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  const t = Date.parse(iso || '');
  if (!t) return '';
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`;
  if (mins < 60 * 24 * 7) return `${Math.floor(mins / (60 * 24))}d`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function canSend(body: string, recipientId: number | null | undefined, isNew: boolean): boolean {
  return body.trim().length > 0 && (!isNew || !!recipientId);
}
