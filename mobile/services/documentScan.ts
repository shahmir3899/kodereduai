// Documents read from a photo (port of the web DocumentUploader + DocumentEditModal, used for both
// student and staff documents). Adding one is image-only: the server stores the file, makes the
// record and reads the rest from the image in the background (scan_status PENDING -> DONE or
// NEEDS_REVIEW). A file already on file is not kept: the existing record wins.

export const STUDENT_DOC_TYPES = [
  { value: 'BIRTH_CERT', label: 'Birth certificate' },
  { value: 'B_FORM', label: 'B-Form / student ID' },
  { value: 'GUARDIAN_ID', label: 'Parent / guardian ID card' },
  { value: 'PREV_REPORT', label: 'Previous report card' },
  { value: 'TC', label: 'Transfer certificate' },
  { value: 'MEDICAL', label: 'Medical record' },
  { value: 'PHOTO', label: 'Photo' },
  { value: 'OTHER', label: 'Other' },
];

export const STAFF_DOC_TYPES = [
  { value: 'ID_DOCUMENT', label: 'ID document' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'DEGREE', label: 'Degree' },
  { value: 'DIPLOMA', label: 'Diploma' },
  { value: 'CERTIFICATION', label: 'Certification' },
  { value: 'TRAINING', label: 'Training' },
  { value: 'LICENSE', label: 'License' },
  { value: 'CERTIFICATE', label: 'Certificate' },
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'OTHER', label: 'Other' },
];

// Staff types that are also a qualification: the record carries institution, year and grade.
export const QUALIFICATION_DOC_TYPES = ['DEGREE', 'DIPLOMA', 'CERTIFICATION', 'TRAINING', 'LICENSE'];

export const typeLabel = (types: Array<{ value: string; label: string }>, value: string) => types.find((t) => t.value === value)?.label ?? value;

export const SCAN_STATUS: Record<string, { label: string; tone: 'info' | 'warning' }> = {
  PENDING: { label: 'Reading…', tone: 'info' },
  NEEDS_REVIEW: { label: 'Needs review', tone: 'warning' },
};

export interface ScannedDoc {
  id: number; document_type: string; title: string; file_url?: string | null; scan_status?: string | null; scan_note?: string | null;
  document_number?: string | null; issue_date?: string | null; expiry_date?: string | null; notes?: string | null;
  institution?: string | null; year_of_completion?: number | null; grade_or_percentage?: string | null;
  read_only?: boolean; branch?: string | null; created_at?: string; uploaded_at?: string;
  staff_member?: number; staff_member_name?: string;
}

export const anyReading = (docs: Array<Pick<ScannedDoc, 'scan_status'>>) => docs.some((d) => d.scan_status === 'PENDING');

export const isImageUrl = (url?: string | null) => !!url && /\.(jpe?g|png|webp)$/i.test(url.split('?')[0]);

export interface DetailsForm {
  type: string; title: string; number: string; issued: string; expiry: string; notes: string;
  institution: string; year: string; grade: string;
}

export const detailsForm = (d: ScannedDoc): DetailsForm => ({
  type: d.document_type || 'OTHER', title: d.title || '', number: d.document_number || '', issued: d.issue_date || '',
  expiry: d.expiry_date || '', notes: d.notes || '', institution: d.institution || '',
  year: d.year_of_completion ? String(d.year_of_completion) : '', grade: d.grade_or_percentage || '',
});

export function validateDetails(f: DetailsForm, thisYear: number): string | null {
  if (!f.title.trim()) return 'Enter a title.';
  if (f.issued && f.expiry && f.expiry < f.issued) return 'The expiry date is before the issue date.';
  if (f.year && (!/^\d{4}$/.test(f.year) || Number(f.year) < 1950 || Number(f.year) > thisYear + 1)) return `Year of completion: 1950 to ${thisYear + 1}.`;
  return null;
}

// The web modal's body: blank dates go as null so a date can be cleared; qualification fields only
// for qualification types (staff), notes and expiry only where the record has them.
export function detailsPayload(f: DetailsForm, opts: { withExpiry?: boolean; withNotes?: boolean } = {}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    document_type: f.type, title: f.title.trim(), document_number: f.number.trim(), issue_date: f.issued || null,
  };
  if (opts.withExpiry !== false) body.expiry_date = f.expiry || null;
  if (opts.withNotes !== false) body.notes = f.notes;
  if (QUALIFICATION_DOC_TYPES.includes(f.type)) {
    body.institution = f.institution.trim();
    body.year_of_completion = f.year ? parseInt(f.year, 10) : null;
    body.grade_or_percentage = f.grade.trim();
  }
  return body;
}

// What the scan endpoints answer: {duplicate, document}.
export function scanReplyMessage(reply: { duplicate?: boolean } | undefined): string {
  return reply?.duplicate
    ? 'This file is already on file, so it was not kept.'
    : 'Uploaded. The details are being read from the picture.';
}

export function scanError(e: unknown, fallback = 'Could not upload the document.'): string {
  const err = e as { response?: { data?: { error?: string; detail?: string } | string } };
  if (!err?.response) return 'No connection. Connect to the internet and try again.';
  const data = err.response.data;
  if (data && typeof data === 'object') return data.error || data.detail || fallback;
  return fallback;
}

export function docSubline(d: ScannedDoc, types: Array<{ value: string; label: string }>): string {
  return [typeLabel(types, d.document_type), d.document_number, (d.created_at || d.uploaded_at || '').slice(0, 10) || null].filter(Boolean).join('  ·  ');
}
