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
}
// A section the server could not build comes back null; absent means module off / not allowed.
export interface DashboardData {
  attendance?: AttendanceSection | null;
  hr?: HrSection | null;
  finance?: FinanceSection | null;
  admissions_new_count?: number | null;
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
  routes: Partial<Record<'attendance' | 'unpaid' | 'leave' | 'payroll' | 'enquiries', string>>;
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
      add('staffatt', Math.max((data.hr.active_staff || 0) - (data.hr.attendance_marked_today || 0), 0), 'staff attendance unmarked', 'amber');
    }
  }
  if (on('admissions')) {
    add('enq', data.admissions_new_count, 'new enquiries', 'blue', routes.enquiries);
  }
  // Array.prototype.sort is stable, so equal tones keep the order above.
  return items.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}
