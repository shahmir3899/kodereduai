import { addDays, format } from 'date-fns';
import type { ModuleKey } from '../constants/modules';

// Pure helpers for the admin dashboard; shapes follow core/bootstrap_views.py and the web's
// AdminDashboard.jsx / AttentionStrip.jsx.

export interface AttendanceSection {
  is_off_day: boolean;
  off_day_types?: string[];
  total_students: number;
  present_count: number;
  absent_count: number;
  leave_count: number;
  not_marked_count: number;
  absent_students?: Array<{ id: number; student_name?: string; class_name?: string }>;
}
export interface HrSection {
  active_staff: number;
  pending_leave_applications: number;
  pending_payroll_approvals: number;
  staff_on_leave_today: number;
  attendance_present_today: number;
  attendance_marked_today: number;
}
export interface FinanceSection {
  total_due: number | string;
  total_collected: number | string;
  total_pending: number | string;
  unpaid_count: number;
  partial_count: number;
  paid_count?: number;
}
export interface TransportSection { total_routes?: number }
export interface LibrarySection { total_overdue?: number; total_books?: number }
export interface HostelSection { total_capacity?: number; current_occupancy?: number }
export interface InventorySection { low_stock_count?: number; total_items?: number }
// A section the server could not build comes back null; absent means module off / not allowed.
export interface DashboardData {
  attendance?: AttendanceSection | null;
  hr?: HrSection | null;
  finance?: FinanceSection | null;
  admissions_new_count?: number | null;
  transport?: TransportSection | null;
  library?: LibrarySection | null;
  hostel?: HostelSection | null;
  inventory?: InventorySection | null;
}

// The term whose dates contain today (the web header does the same); null between terms.
export function currentTermName(terms: Array<{ name?: string; start_date?: string; end_date?: string }>, today: string): string | null {
  const t = terms.find((x) => x.start_date && x.end_date && x.start_date <= today && x.end_date >= today);
  return t?.name ?? null;
}

export function attendanceRate(a: AttendanceSection | null | undefined): number | null {
  if (!a || a.is_off_day || !(a.total_students > 0)) return null;
  return Math.min(100, Math.round((a.present_count / a.total_students) * 100));
}

export function staffPresentPct(hr: HrSection | null | undefined, isOffDay: boolean): number | null {
  if (!hr || isOffDay || !(hr.active_staff > 0)) return null;
  return Math.round(((hr.attendance_present_today || 0) / hr.active_staff) * 100);
}

export function collectionRate(f: FinanceSection | null | undefined): number | null {
  const due = Number(f?.total_due ?? 0);
  if (!f || !(due > 0)) return null;
  return Math.min(100, Math.round((Number(f.total_collected) / due) * 100));
}

// Daily attendance is measured for a past day too, but never for the future.
export function stepDate(date: string, delta: number, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = format(addDays(new Date(y, m - 1, d), delta), 'yyyy-MM-dd');
  return next > today ? today : next;
}

export type Tone = 'red' | 'amber' | 'blue';
export interface AttentionItem {
  key: string;
  count: number;
  label: string;
  tone: Tone;
  // Mobile route, only where that screen already exists.
  href?: string;
}

const TONE_RANK: Record<Tone, number> = { red: 0, amber: 1, blue: 2 };

export function buildAttentionItems(input: {
  isModuleEnabled: (key: ModuleKey) => boolean;
  data: DashboardData;
  isToday: boolean;
  // Alerts from the AI insights list; they have no screen of their own, so the chip is not tappable.
  aiAlerts?: number;
  routes: Partial<Record<'attendance' | 'unpaid' | 'leave' | 'payroll' | 'enquiries' | 'staffAttendance' | 'library' | 'inventory', string>>;
}): AttentionItem[] {
  const { isModuleEnabled: on, data, isToday, routes } = input;
  const items: AttentionItem[] = [];
  const add = (key: string, count: unknown, label: string, tone: Tone, href?: string) => {
    if (Number(count) > 0) items.push({ key, count: Number(count), label, tone, href });
  };
  const offDay = !!data.attendance?.is_off_day;

  // "Not marked" is only a to-do for today; a past day's gap can't be fixed from here.
  if (on('attendance') && isToday && !offDay) {
    add('att', data.attendance?.not_marked_count, 'students not marked today', 'red', routes.attendance);
  }
  if (on('finance')) {
    add('unpaid', data.finance?.unpaid_count, 'monthly fees unpaid this month', 'red', routes.unpaid);
    add('partial', data.finance?.partial_count, 'monthly fees partially paid', 'amber', routes.unpaid);
  }
  if (on('hr')) {
    add('leave', data.hr?.pending_leave_applications, 'leave requests pending', 'amber', routes.leave);
    add('payroll', data.hr?.pending_payroll_approvals, 'payslips awaiting approval', 'amber', routes.payroll);
    if (isToday && !offDay && data.hr) {
      add('staffatt', Math.max((data.hr.active_staff || 0) - (data.hr.attendance_marked_today || 0), 0), 'staff attendance unmarked', 'amber', routes.staffAttendance);
    }
  }
  if (on('admissions')) {
    add('enq', data.admissions_new_count, 'new enquiries', 'blue', routes.enquiries);
  }
  if (on('library')) add('lib', data.library?.total_overdue, 'overdue library books', 'amber', routes.library);
  if (on('inventory')) add('stock', data.inventory?.low_stock_count, 'items low on stock', 'red', routes.inventory);
  add('ai', input.aiAlerts, 'AI alerts', 'red');
  // Array.prototype.sort is stable, so equal tones keep the order above.
  return items.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}

export type HealthStatus = 'green' | 'yellow' | 'red' | 'gray';
export interface ModuleCard {
  key: string;
  label: string;
  metric: string | number;
  metricLabel: string;
  status: HealthStatus;
  route?: string;
}

const rateStatus = (r: number | null, hi: number, mid: number): HealthStatus =>
  r == null ? 'gray' : r >= hi ? 'green' : r >= mid ? 'yellow' : 'red';

// Same metric, label and colour rules as the web "Module Overview" grid. A module whose section
// failed (null) shows a dash on a grey dot, never a made-up 0.
export function buildModuleCards(input: {
  isModuleEnabled: (key: ModuleKey) => boolean;
  data: DashboardData;
  upcomingExams: number | null;
  routes: Partial<Record<'attendance' | 'finance' | 'hr' | 'exams' | 'admissions' | 'transport' | 'library' | 'hostel' | 'inventory', string>>;
}): ModuleCard[] {
  const { isModuleEnabled: on, data, upcomingExams, routes } = input;
  const cards: ModuleCard[] = [];
  const offDay = !!data.attendance?.is_off_day;

  if (on('attendance')) {
    const r = attendanceRate(data.attendance);
    cards.push({ key: 'attendance', label: 'Attendance', metric: offDay ? 'N/A' : r != null ? `${r}%` : '—',
      metricLabel: offDay ? 'off day' : 'today', status: rateStatus(r, 90, 75), route: routes.attendance });
  }
  if (on('finance')) {
    const r = collectionRate(data.finance);
    cards.push({ key: 'finance', label: 'Finance', metric: r != null ? `${r}%` : '—', metricLabel: 'collected',
      status: rateStatus(r, 80, 50), route: routes.finance });
  }
  if (on('hr')) {
    const p = staffPresentPct(data.hr, offDay);
    cards.push({ key: 'hr', label: 'HR & Staff', metric: offDay ? 'N/A' : p != null ? `${p}%` : '—',
      metricLabel: offDay ? 'off day' : 'present', status: rateStatus(p, 90, 75), route: routes.hr });
  }
  if (on('examinations')) {
    cards.push({ key: 'exams', label: 'Examinations', metric: upcomingExams ?? '—', metricLabel: 'upcoming', status: 'gray', route: routes.exams });
  }
  if (on('admissions')) {
    const n = data.admissions_new_count;
    cards.push({ key: 'admissions', label: 'Admissions', metric: n ?? '—', metricLabel: 'new enquiries',
      status: n == null ? 'gray' : n > 0 ? 'yellow' : 'green', route: routes.admissions });
  }
  if (on('transport') && data.transport !== undefined) {
    cards.push({ key: 'transport', label: 'Transport', metric: data.transport?.total_routes ?? '—', metricLabel: 'routes', status: 'gray', route: routes.transport });
  }
  if (on('library') && data.library !== undefined) {
    const overdue = data.library?.total_overdue ?? 0;
    cards.push({ key: 'library', label: 'Library', metric: data.library ? (overdue > 0 ? overdue : data.library.total_books ?? '—') : '—',
      metricLabel: overdue > 0 ? 'overdue' : 'books', status: !data.library ? 'gray' : overdue > 0 ? 'yellow' : 'green', route: routes.library });
  }
  if (on('hostel') && data.hostel !== undefined) {
    const h = data.hostel;
    const occ = h && (h.total_capacity ?? 0) > 0 ? Math.round(((h.current_occupancy ?? 0) / (h.total_capacity ?? 1)) * 100) : null;
    cards.push({ key: 'hostel', label: 'Hostel', metric: occ != null ? `${occ}%` : '—', metricLabel: 'occupancy', status: 'gray', route: routes.hostel });
  }
  if (on('inventory') && data.inventory !== undefined) {
    const low = data.inventory?.low_stock_count ?? 0;
    cards.push({ key: 'inventory', label: 'Inventory', metric: data.inventory ? (low > 0 ? low : data.inventory.total_items ?? '—') : '—',
      metricLabel: low > 0 ? 'low stock' : 'items', status: !data.inventory ? 'gray' : low > 0 ? 'red' : 'green', route: routes.inventory });
  }
  return cards;
}

export interface PredictorRow {
  key: string;
  label: string;
  count: number;
  levels?: { HIGH?: number; MEDIUM?: number; LOW?: number };
  note?: string;
  route?: string;
}

// Leads the admissions predictor rates LOW are the ones "going cold".
export function goingColdCount(data: { enquiries?: Array<{ likelihood?: string }> } | undefined): number {
  return (data?.enquiries ?? []).filter((e) => e.likelihood === 'LOW').length;
}

// Rows with nothing at risk are left out, as on the web; the card hides when none are left.
export function visiblePredictors(rows: PredictorRow[]): PredictorRow[] {
  return rows.filter((r) => r.count > 0);
}
