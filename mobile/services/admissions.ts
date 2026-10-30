// Pure logic for the Admissions screens; port of frontend/src/pages/admissions (Enquiries, form,
// Conversion Likelihood), components/BatchConvertModal and the rules in backend/admissions
// (serializers.py, views.py). The server re-checks everything; these checks only save a round trip
// and say what is wrong in plain words.
import { format } from 'date-fns';
import { inventoryErrorMessage } from './inventory';

export const admissionsErrorMessage = inventoryErrorMessage;

// ─── Reference lists (same values as the web and the model's choices) ──────────────────────

// frontend/src/constants/gradePresets.js: the number the server stores in applying_for_grade_level.
export const GRADES = [
  { value: 0, label: 'Playgroup' }, { value: 1, label: 'Nursery' }, { value: 2, label: 'Prep' },
  { value: 3, label: 'Class 1' }, { value: 4, label: 'Class 2' }, { value: 5, label: 'Class 3' },
  { value: 6, label: 'Class 4' }, { value: 7, label: 'Class 5' }, { value: 8, label: 'Class 6' },
  { value: 9, label: 'Class 7' }, { value: 10, label: 'Class 8' }, { value: 11, label: 'Class 9' },
  { value: 12, label: 'Class 10' },
] as const;

export function gradeLabel(level: number | null | undefined): string {
  if (level === null || level === undefined) return 'No grade';
  return GRADES.find((g) => g.value === level)?.label ?? `Grade ${level}`;
}

export const SOURCES = [
  { value: 'WALK_IN', label: 'Walk-in' }, { value: 'PHONE', label: 'Phone Call' }, { value: 'WEBSITE', label: 'Website' },
  { value: 'WHATSAPP', label: 'WhatsApp' }, { value: 'REFERRAL', label: 'Referral' }, { value: 'SOCIAL_MEDIA', label: 'Social Media' },
  { value: 'AD_CAMPAIGN', label: 'Ad Campaign' }, { value: 'OTHER', label: 'Other' },
] as const;

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return '–';
  return SOURCES.find((s) => s.value === source)?.label ?? source.replace(/_/g, ' ');
}

export type EnquiryStatus = 'NEW' | 'CONFIRMED' | 'CONVERTED' | 'CANCELLED';

export const STATUSES: Array<{ value: EnquiryStatus; label: string; hint: string; tone: 'info' | 'success' | 'neutral' | 'error' }> = [
  { value: 'NEW', label: 'New', hint: 'Awaiting confirmation', tone: 'info' },
  { value: 'CONFIRMED', label: 'Confirmed', hint: 'Ready to convert', tone: 'success' },
  { value: 'CONVERTED', label: 'Converted', hint: 'Now students', tone: 'neutral' },
  { value: 'CANCELLED', label: 'Cancelled', hint: 'Dropped out', tone: 'error' },
];

export const statusLabel = (s: string) => STATUSES.find((x) => x.value === s)?.label ?? s;
export const statusTone = (s: string) => STATUSES.find((x) => x.value === s)?.tone ?? 'neutral';

// ─── Records ───────────────────────────────────────────────────────────────────────────────

export interface Enquiry {
  id: number;
  name: string;
  father_name: string;
  mobile: string;
  applying_for_grade_level: number | null;
  status: EnquiryStatus;
  status_display?: string;
  source: string;
  source_display?: string;
  next_followup_date: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface EnquiryNote {
  id: number;
  note: string;
  note_type: 'NOTE' | 'CALL' | 'STATUS_CHANGE' | 'SYSTEM';
  user_name?: string;
  created_at: string;
}

export interface EnquiryDetail extends Enquiry {
  notes: string;
  converted_student: number | null;
  converted_student_name: string | null;
  notes_list: EnquiryNote[];
}

export type StatusCounts = Record<EnquiryStatus, number> & { total: number };

export const EMPTY_COUNTS: StatusCounts = { NEW: 0, CONFIRMED: 0, CONVERTED: 0, CANCELLED: 0, total: 0 };

// Share of all enquiries that became students, as the web funnel shows it.
export function conversionRate(counts: Pick<StatusCounts, EnquiryStatus>): number {
  const total = counts.NEW + counts.CONFIRMED + counts.CONVERTED + counts.CANCELLED;
  return total ? Math.round((counts.CONVERTED / total) * 100) : 0;
}

// ─── What each status allows (EnquiriesPage.jsx; update_status refuses CONVERTED) ──────────

export const canConfirm = (e: Pick<Enquiry, 'status'>) => e.status === 'NEW';
export const canConvert = (e: Pick<Enquiry, 'status'>) => e.status === 'CONFIRMED';
// Cancelling deletes the enquiry for good (owner's call, 2026-10-29), as on the web.
export const canCancel = (e: Pick<Enquiry, 'status'>) => e.status === 'NEW' || e.status === 'CONFIRMED';
// Rows cancelled before cancel became a delete can still be cleaned up.
export const canDeleteCancelled = (e: Pick<Enquiry, 'status'>) => e.status === 'CANCELLED';
// A converted enquiry keeps its link to the student: the web hides edit and delete for it, and so
// does the phone, although the server would allow both.
export const canEdit = (e: Pick<Enquiry, 'status'>) => e.status !== 'CONVERTED';

// ─── Follow-ups ────────────────────────────────────────────────────────────────────────────

export type FollowUpState = 'overdue' | 'today' | 'upcoming' | null;

// Only open enquiries are chased (the followups endpoints exclude CONVERTED and CANCELLED).
export function followUpState(e: Pick<Enquiry, 'status' | 'next_followup_date'>, today: string): FollowUpState {
  if (!e.next_followup_date || (e.status !== 'NEW' && e.status !== 'CONFIRMED')) return null;
  if (e.next_followup_date < today) return 'overdue';
  return e.next_followup_date === today ? 'today' : 'upcoming';
}

export type FollowUpFilter = '' | 'today' | 'overdue';

export interface ListFilters { status: '' | EnquiryStatus; grade: number | null; source: string; search: string }
export const NO_FILTERS: ListFilters = { status: '', grade: null, source: '', search: '' };

export const hasFilters = (f: ListFilters, followUp: FollowUpFilter = '') =>
  !!(f.status || f.grade !== null || f.source || f.search.trim() || followUp);

// The follow-up endpoints are not filterable or paged, so their rows are narrowed here with the
// same rules the list endpoint applies (name, father or mobile contains the term).
export function filterEnquiries(rows: Enquiry[], f: ListFilters): Enquiry[] {
  const term = f.search.trim().toLowerCase();
  return rows.filter((e) => {
    if (f.status && e.status !== f.status) return false;
    if (f.grade !== null && e.applying_for_grade_level !== f.grade) return false;
    if (f.source && e.source !== f.source) return false;
    if (term && ![e.name, e.father_name, e.mobile].some((v) => (v ?? '').toLowerCase().includes(term))) return false;
    return true;
  });
}

// ─── Create and edit form ──────────────────────────────────────────────────────────────────

export interface EnquiryForm {
  name: string;
  fatherName: string;
  mobile: string;
  grade: number | null;
  source: string;
  followUp: string;
  notes: string;
}

export const emptyEnquiryForm = (): EnquiryForm => ({
  name: '', fatherName: '', mobile: '', grade: null, source: 'WALK_IN', followUp: '', notes: '',
});

export function enquiryToForm(e: Partial<EnquiryDetail>): EnquiryForm {
  return {
    name: e.name ?? '',
    fatherName: e.father_name ?? '',
    mobile: e.mobile ?? '',
    grade: e.applying_for_grade_level ?? null,
    source: e.source || 'WALK_IN',
    followUp: e.next_followup_date ?? '',
    notes: e.notes ?? '',
  };
}

// Same three required fields as the server's EnquiryCreateSerializer.validate.
export function validateEnquiry(f: EnquiryForm): string | null {
  if (!f.name.trim()) return "Enter the child's name.";
  if (!f.fatherName.trim()) return "Enter the father's name.";
  if (!f.mobile.trim()) return 'Enter a mobile number.';
  return null;
}

// The server's validate() demands name, father_name and mobile on every write, a PATCH included,
// so an edit always sends the whole form. On an edit an emptied grade or date is sent as null so it
// can be cleared; on a create a blank is simply left out.
export function buildEnquiryPayload(f: EnquiryForm, editing: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: f.name.trim(),
    father_name: f.fatherName.trim(),
    mobile: f.mobile.trim(),
    source: f.source || 'WALK_IN',
    notes: f.notes.trim(),
  };
  if (f.grade !== null) payload.applying_for_grade_level = f.grade;
  else if (editing) payload.applying_for_grade_level = null;
  if (f.followUp) payload.next_followup_date = f.followUp;
  else if (editing) payload.next_followup_date = null;
  return payload;
}

// ─── Notes ─────────────────────────────────────────────────────────────────────────────────

// The phone only writes these two; status changes and system lines come from the server.
export const NOTE_TYPES = [{ value: 'NOTE', label: 'Note' }, { value: 'CALL', label: 'Phone call' }] as const;

export const noteTypeLabel = (t: string) =>
  ({ NOTE: 'Note', CALL: 'Phone call', STATUS_CHANGE: 'Status change', SYSTEM: 'System' } as Record<string, string>)[t] ?? t;

export function validateNote(text: string): string | null {
  return text.trim() ? null : 'Write the note first.';
}

export function buildNotePayload(text: string, type: 'NOTE' | 'CALL'): { note: string; note_type: 'NOTE' | 'CALL' } {
  return { note: text.trim(), note_type: type };
}

// ─── Phone ─────────────────────────────────────────────────────────────────────────────────

// Keeps digits and a leading plus; spaces and dashes break some dialers.
export function telUrl(mobile: string): string | null {
  const cleaned = mobile.trim().replace(/(?!^\+)[^\d]/g, '');
  return cleaned.replace('+', '') ? `tel:${cleaned}` : null;
}

// ─── Conversion to students (BatchConvertModal.jsx, BatchConvertSerializer) ────────────────

export const FEE_TYPES = [
  { value: 'ADMISSION', label: 'Admission fee (one-time)' },
  { value: 'ANNUAL', label: 'Annual fee (yearly)' },
  { value: 'BOOKS', label: 'Books fee' },
  { value: 'MONTHLY', label: 'Monthly fee (current month)' },
] as const;

export type FeeTypeCode = (typeof FEE_TYPES)[number]['value'];

export interface ConvertForm {
  yearId: number | null;
  sectionId: number | null;
  generateFees: boolean;
  feeTypes: FeeTypeCode[];
}

export const emptyConvertForm = (yearId: number | null = null): ConvertForm => ({
  yearId, sectionId: null, generateFees: false, feeTypes: ['ADMISSION', 'ANNUAL'],
});

export function validateConvert(f: ConvertForm, count: number): string | null {
  if (count < 1) return 'Select at least one confirmed enquiry.';
  if (!f.yearId) return 'Choose the academic year.';
  if (!f.sectionId) return 'Choose the class and section.';
  if (f.generateFees && f.feeTypes.length === 0) return 'Choose at least one fee type.';
  return null;
}

export function buildConvertPayload(ids: number[], f: ConvertForm): Record<string, unknown> {
  return {
    enquiry_ids: ids,
    academic_year_id: f.yearId,
    session_class_id: f.sectionId,
    generate_fees: f.generateFees,
    fee_types: f.generateFees ? f.feeTypes : [],
  };
}

export interface Section { id: number; display_name?: string; section?: string | null; grade_level?: number | null }

export function sectionLabel(s: Pick<Section, 'display_name' | 'section'>): string {
  const name = s.display_name ?? '';
  return s.section ? `${name} - ${s.section}` : name;
}

// Warns, never blocks: the web does the same when an enquiry applied for another grade.
export function gradeMismatches(enquiries: Pick<Enquiry, 'name' | 'applying_for_grade_level'>[], section: Pick<Section, 'grade_level'> | null | undefined): string[] {
  if (!section || section.grade_level === null || section.grade_level === undefined) return [];
  return enquiries
    .filter((e) => e.applying_for_grade_level !== null && e.applying_for_grade_level !== section.grade_level)
    .map((e) => e.name);
}

export interface ConvertResult {
  detail?: string;
  converted_count?: number;
  fees_generated_count?: number;
  errors?: Array<{ enquiry_id: number; name: string; error: string }>;
}

// Conversion can half succeed: some students are created and others fail. The server answers 400
// only when nothing converted, and its error text can be a long stack-like string, so only the
// first line is shown.
export function summariseConvert(result: ConvertResult | null | undefined): { message: string; failures: string[]; allFailed: boolean } {
  const count = result?.converted_count ?? 0;
  const fees = result?.fees_generated_count ?? 0;
  const failures = (result?.errors ?? []).map((e) => `${e.name}: ${(e.error || 'Unknown error').split('\n')[0]}`);
  const noun = `${count} enquir${count === 1 ? 'y' : 'ies'}`;
  const feeText = fees > 0 ? ` with ${fees} fee record${fees === 1 ? '' : 's'}` : '';
  return {
    message: count > 0 ? `${noun} converted to students${feeText}.` : 'No enquiry was converted.',
    failures,
    allFailed: count === 0,
  };
}

// ─── Conversion likelihood (ConversionLikelihoodPage.jsx) ──────────────────────────────────

export type Likelihood = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ScoredEnquiry {
  enquiry_id: number;
  student_name: string;
  source: string;
  likelihood: Likelihood;
  score: number;
  response_detail?: string;
  activity_detail?: string;
  followup_detail?: string;
  suggested_action?: string;
}

export interface LikelihoodResult {
  total_open: number;
  likelihood_levels?: Partial<Record<Likelihood, number>>;
  enquiries: ScoredEnquiry[];
}

export const LIKELIHOODS: Array<{ value: '' | Likelihood; label: string }> = [
  { value: '', label: 'All' }, { value: 'HIGH', label: 'High' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'LOW', label: 'Low' },
];

export const LIKELIHOOD_TONE: Record<Likelihood, 'success' | 'warning' | 'neutral'> = {
  HIGH: 'success', MEDIUM: 'warning', LOW: 'neutral',
};

export function filterScored(rows: ScoredEnquiry[], level: '' | Likelihood): ScoredEnquiry[] {
  return level ? rows.filter((r) => r.likelihood === level) : rows;
}

// ─── Dates ─────────────────────────────────────────────────────────────────────────────────

// 'yyyy-MM-dd' read as a local date: new Date('2026-01-05') is UTC midnight and shows the
// previous day west of UTC.
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return format(new Date(y, m - 1, d), 'd MMM yyyy');
}

export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : format(d, 'd MMM yyyy, h:mm a');
}
