// Pure logic for the attendance anomalies list: unusual patterns the server finds each day (a whole
// class absent, a student's pattern changing, an odd day). An admin reviews each one and resolves it
// with a note. Admin and principal only; the server refuses the rest.

export interface Anomaly {
  id: number;
  anomaly_type: 'CLASS_BULK' | 'STUDENT_PATTERN' | 'UNUSUAL_DAY' | string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  date: string;
  class_name?: string | null;
  student_name?: string | null;
  description: string;
  is_resolved: boolean;
  resolved_by_name?: string | null;
  resolved_at?: string | null;
  resolution_notes?: string | null;
}

export const TYPE_LABELS: Record<string, string> = {
  CLASS_BULK: 'Bulk class absence', STUDENT_PATTERN: 'Student pattern', UNUSUAL_DAY: 'Unusual day',
};

export const TYPE_FILTERS = [
  { value: '', label: 'All types' }, { value: 'CLASS_BULK', label: 'Bulk class absence' },
  { value: 'STUDENT_PATTERN', label: 'Student pattern' }, { value: 'UNUSUAL_DAY', label: 'Unusual day' },
];

export type StateFilter = 'open' | 'resolved';
export const STATE_FILTERS: Array<{ value: StateFilter; label: string }> = [{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }];

export function anomalyParams(state: StateFilter, type: string): Record<string, unknown> {
  return { is_resolved: state === 'resolved', page_size: 50, ...(type ? { anomaly_type: type } : {}) };
}

export function severityTone(s: string): 'error' | 'warning' | 'info' {
  return s === 'HIGH' ? 'error' : s === 'MEDIUM' ? 'warning' : 'info';
}

export const severityLabel = (s: string) => (s ? s[0] + s.slice(1).toLowerCase() : '');

export const anomalyTitle = (a: Pick<Anomaly, 'anomaly_type'>) => TYPE_LABELS[a.anomaly_type] ?? a.anomaly_type;

// Who it is about: the student, else the class, else nothing.
export const anomalySubject = (a: Pick<Anomaly, 'student_name' | 'class_name'>) =>
  [a.student_name, a.class_name].filter(Boolean).join('  ·  ');

// The server takes the note as "notes" and keeps it as resolution_notes.
export const resolvePayload = (notes: string) => ({ notes: notes.trim() });

export const resolvedLine = (a: Pick<Anomaly, 'resolved_by_name' | 'resolved_at' | 'resolution_notes'>): string =>
  [a.resolved_by_name ? `Resolved by ${a.resolved_by_name}` : 'Resolved', a.resolved_at ? a.resolved_at.slice(0, 10) : null, a.resolution_notes || null]
    .filter(Boolean).join('  ·  ');

// An already resolved item answers 400 "Already resolved"; say what happened in plain words.
export function resolveErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { error?: string; detail?: string } } })?.response?.data;
  if (data?.error === 'Already resolved') return 'Someone already resolved this one.';
  return data?.detail || data?.error || 'Could not resolve it.';
}

// The numbers on the attendance hub. Nothing is shown when a number is unknown or the day is off, so
// the hub never claims something it does not know.
export const hubLine = {
  today(d: { is_off_day?: boolean; not_marked_count?: number; total_students?: number } | null | undefined): string | null {
    if (!d || d.total_students == null) return null;
    if (d.is_off_day) return 'Today is an off day';
    const n = d.not_marked_count ?? 0;
    return n === 0 ? 'Everyone is marked today' : `${n} student${n === 1 ? '' : 's'} not marked today`;
  },
  anomalies(open: number | null | undefined): string | null {
    if (open == null) return null;
    return open === 0 ? 'Nothing to review' : `${open} to review`;
  },
};
