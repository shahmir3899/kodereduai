// Pure logic for the admin's send-notification screen. The field names and choices are the server's
// (notifications/serializers.py: BroadcastNotificationSerializer, SendNotificationSerializer), not
// the older mobile screen's, which posted a shape the server did not accept.

export interface Choice { value: string; label: string }

// Who a broadcast goes to: every active user holding that role in the school (parents and students
// can be narrowed to one section).
export const AUDIENCES: Choice[] = [
  { value: 'PARENT', label: 'All parents' },
  { value: 'TEACHER', label: 'All teachers' },
  { value: 'STAFF', label: 'All staff' },
  { value: 'STUDENT', label: 'All students' },
  { value: 'SCHOOL_ADMIN', label: 'All admins' },
  { value: 'PRINCIPAL', label: 'Principals' },
  { value: 'MANAGER', label: 'Managers' },
];

// WhatsApp was switched off on the server in May 2026 and there is no SMS channel.
export const CHANNELS: Choice[] = [
  { value: 'IN_APP', label: 'In-app' },
  { value: 'PUSH', label: 'Push notification' },
  { value: 'EMAIL', label: 'Email' },
];

export const EVENT_TYPES: Choice[] = [
  { value: 'GENERAL', label: 'General announcement' },
  { value: 'CUSTOM', label: 'Custom message' },
  { value: 'EXAM_SCHEDULE', label: 'Exam schedule published' },
  { value: 'EXAM_RESULT', label: 'Exam result published' },
  { value: 'FEE_DUE', label: 'Fee due reminder' },
  { value: 'FEE_OVERDUE', label: 'Fee overdue alert' },
  { value: 'TRANSPORT_UPDATE', label: 'Transport update' },
  { value: 'LIBRARY_OVERDUE', label: 'Library overdue reminder' },
  { value: 'ASSIGNMENT_DUE', label: 'Assignment due reminder' },
  { value: 'ABSENCE', label: 'Absence alert' },
];

export const SECTION_AUDIENCES = new Set(['PARENT', 'STUDENT']);
export const audienceHasSections = (audience: string) => SECTION_AUDIENCES.has(audience);

export type Mode = 'broadcast' | 'single';

export interface ComposeForm {
  eventType: string;
  channel: string;
  title: string;
  body: string;
  audience: string;
  // A section (session class) id, or a master class id when the year has no sections.
  placement: { id: number; classObj: number | null; isSession: boolean } | null;
  // The chosen person, for "send to one person".
  recipientId: number | null;
  recipientRole: string;
}

export const emptyCompose = (): ComposeForm => ({
  eventType: 'GENERAL', channel: 'IN_APP', title: '', body: '', audience: 'PARENT', placement: null, recipientId: null, recipientRole: '',
});

// Template placeholders such as {{student_name}} are filled per student by automatic notifications. A
// manual message has no student, so one left in the text would be sent as it is.
export function findPlaceholders(text: string): string[] {
  const found = text.match(/\{\{\s*\w+\s*\}\}/g) ?? [];
  return Array.from(new Set(found.map((p) => p.replace(/[{}\s]/g, ''))));
}

export function composePlaceholders(f: Pick<ComposeForm, 'title' | 'body'>): string[] {
  return Array.from(new Set([...findPlaceholders(f.title), ...findPlaceholders(f.body)]));
}

export function validateCompose(f: ComposeForm, mode: Mode): string | null {
  if (mode === 'single' && f.recipientId == null) return 'Choose who to send it to.';
  if (!f.title.trim()) return 'Enter a title.';
  if (f.title.trim().length > 200) return 'The title can be at most 200 characters.';
  if (!f.body.trim()) return 'Enter the message.';
  return null;
}

function sectionFilter(f: ComposeForm): Record<string, number> {
  if (!audienceHasSections(f.audience) || !f.placement) return {};
  return f.placement.isSession
    ? { session_class_id: f.placement.id }
    : { class_obj_id: f.placement.classObj ?? f.placement.id };
}

export function buildBroadcastPayload(f: ComposeForm) {
  return {
    event_type: f.eventType, channel: f.channel, recipient_type: f.audience,
    title: f.title.trim(), body: f.body.trim(), ...sectionFilter(f),
  };
}

// The recipient preview takes the same audience, with no message.
export function buildPreviewPayload(f: ComposeForm) {
  return { channel: f.channel, recipient_type: f.audience, ...sectionFilter(f) };
}

// The log records parents, admins and "staff" (everyone else), as the server does for a broadcast.
export function logRecipientType(role: string): 'PARENT' | 'STAFF' | 'ADMIN' {
  if (role === 'PARENT') return 'PARENT';
  if (role === 'SCHOOL_ADMIN' || role === 'PRINCIPAL' || role === 'SUPER_ADMIN') return 'ADMIN';
  return 'STAFF';
}

export function buildSinglePayload(f: ComposeForm) {
  return {
    event_type: f.eventType, channel: f.channel, recipient_identifier: String(f.recipientId),
    recipient_type: logRecipientType(f.recipientRole), title: f.title.trim(), body: f.body.trim(),
  };
}

export interface BroadcastResult { sent?: number; failed?: number; skipped?: number; total_recipients?: number }

export function broadcastResultText(r: BroadcastResult): string {
  const parts = [`Sent to ${r.sent ?? 0} of ${r.total_recipients ?? 0}`];
  if (r.skipped) parts.push(`${r.skipped} skipped (opted out or channel off)`);
  if (r.failed) parts.push(`${r.failed} failed`);
  return parts.join(', ') + '.';
}

export interface RecipientPreview { count: number; samples: Array<{ id: number; name: string }> }

export function previewLine(p: RecipientPreview): string {
  if (p.count === 0) return 'No one would receive this.';
  const names = p.samples.slice(0, 3).map((s) => s.name).join(', ');
  const more = p.count > 3 ? ` and ${p.count - 3} more` : '';
  return `${p.count} ${p.count === 1 ? 'person' : 'people'}: ${names}${more}`;
}

// A template fills the form but never overwrites a channel the server will not send on.
export interface NotificationTemplate {
  id: number; name: string; event_type: string; channel: string; subject_template?: string; body_template: string; is_active?: boolean;
}

export function applyTemplate(f: ComposeForm, t: NotificationTemplate): ComposeForm {
  const channel = CHANNELS.some((c) => c.value === t.channel) ? t.channel : f.channel;
  const eventType = EVENT_TYPES.some((e) => e.value === t.event_type) ? t.event_type : f.eventType;
  return { ...f, eventType, channel, title: t.subject_template ?? '', body: t.body_template };
}

// The server's refusal ("No users found with role ...", a validation message) comes as detail or
// field messages; show what it says.
export function sendErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === 'string' && data.trim() && data.length < 200) return data;
  if (data && typeof data === 'object') {
    for (const value of Object.values(data as Record<string, unknown>)) {
      const text = Array.isArray(value) ? value.map(String).join(' ') : typeof value === 'string' ? value : '';
      if (text) return text;
    }
  }
  return fallback;
}
