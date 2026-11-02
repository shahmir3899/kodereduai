// Pure logic for the Add and Edit student form. Field names, limits and normalising rules mirror
// the web (frontend/src/pages/students/studentFieldConfig.js and studentFormUtils.js) so a student
// saved on either side looks the same to the API. Nothing here touches the network.

export type StudentSection = 'basic' | 'personal' | 'guardian' | 'admission';
export type FieldType = 'text' | 'textarea' | 'date' | 'email' | 'tel' | 'select';

export interface StudentField {
  name: string;
  label: string;
  section: StudentSection;
  type: FieldType;
  required?: boolean;
  // Shown on the compact Add form; everything else sits behind "More fields".
  quick?: boolean;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
  phone?: boolean;
}

export const SECTIONS: Array<{ key: StudentSection; label: string }> = [
  { key: 'basic', label: 'Basic' },
  { key: 'personal', label: 'Personal' },
  { key: 'guardian', label: 'Parent and guardian' },
  { key: 'admission', label: 'Admission' },
];

export const GENDER_OPTIONS = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'O', label: 'Other' },
];

export const STUDENT_FIELDS: StudentField[] = [
  { name: 'name', label: 'Student name', section: 'basic', type: 'text', required: true, quick: true, maxLength: 200 },
  { name: 'roll_number', label: 'Roll number', section: 'basic', type: 'text', required: true, quick: true, maxLength: 20 },

  { name: 'date_of_birth', label: 'Date of birth', section: 'personal', type: 'date' },
  { name: 'gender', label: 'Gender', section: 'personal', type: 'select' },
  { name: 'blood_group', label: 'Blood group', section: 'personal', type: 'text', maxLength: 5 },
  { name: 'address', label: 'Address', section: 'personal', type: 'textarea' },

  { name: 'parent_name', label: 'Parent name', section: 'guardian', type: 'text', quick: true, maxLength: 200 },
  {
    name: 'parent_phone', label: 'Parent phone', section: 'guardian', type: 'tel', phone: true, quick: true, maxLength: 20,
    placeholder: '+923001234567', hint: 'Use +92 format (for example +923001234567) for notifications',
  },
  { name: 'guardian_name', label: 'Guardian name', section: 'guardian', type: 'text', maxLength: 200 },
  { name: 'guardian_relation', label: 'Guardian relation', section: 'guardian', type: 'text', maxLength: 50 },
  { name: 'guardian_phone', label: 'Guardian phone', section: 'guardian', type: 'tel', phone: true, maxLength: 20 },
  { name: 'guardian_email', label: 'Guardian email', section: 'guardian', type: 'email' },
  { name: 'guardian_occupation', label: 'Guardian occupation', section: 'guardian', type: 'text', maxLength: 100 },
  { name: 'guardian_address', label: 'Guardian address', section: 'guardian', type: 'textarea' },
  { name: 'emergency_contact', label: 'Emergency contact', section: 'guardian', type: 'tel', phone: true, maxLength: 20 },

  { name: 'admission_number', label: 'Admission number', section: 'admission', type: 'text', maxLength: 30 },
  { name: 'admission_date', label: 'Admission date', section: 'admission', type: 'date' },
  { name: 'previous_school', label: 'Previous school', section: 'admission', type: 'text', maxLength: 200 },
];

export type StudentForm = Record<string, string>;

export const fieldsIn = (section: StudentSection, quickOnly = false) =>
  STUDENT_FIELDS.filter((f) => f.section === section && (!quickOnly || f.quick));

export function normalizeGender(gender: unknown): string {
  if (!gender) return '';
  const value = String(gender).trim().toUpperCase();
  if (value === 'MALE') return 'M';
  if (value === 'FEMALE') return 'F';
  if (value === 'OTHER') return 'O';
  return value === 'M' || value === 'F' || value === 'O' ? value : '';
}

// Turns a typed or pasted number into +92XXXXXXXXXX where it can (03xx..., 3xxxxxxxxx, 92xxxxxxxxxx).
export function parsePhone(raw: unknown): string {
  if (!raw) return '';
  let phone = String(raw).trim();
  // Legacy spreadsheet imports prefixed numbers with "P:" to keep them as text.
  if (phone.toUpperCase().startsWith('P:')) phone = phone.substring(2).trim();
  phone = phone.replace(/[^\d+]/g, '');
  if (phone.startsWith('03')) return '+92' + phone.substring(1);
  if (phone.startsWith('3') && phone.length === 10) return '+92' + phone;
  if (phone.startsWith('92') && !phone.startsWith('+')) return '+' + phone;
  return phone;
}

export function emptyForm(): StudentForm {
  return Object.fromEntries(STUDENT_FIELDS.map((f) => [f.name, '']));
}

// The student as the API returns it, into form values. Missing and null become empty strings.
export function studentToForm(student: Record<string, unknown> | null | undefined): StudentForm {
  const form = emptyForm();
  if (!student) return form;
  for (const f of STUDENT_FIELDS) {
    const v = student[f.name];
    form[f.name] = v == null ? '' : String(v);
  }
  form.gender = normalizeGender(student.gender);
  return form;
}

// Only the parent phone is reformatted, as on the web: silently rewriting guardian or emergency
// numbers on save would be a behaviour change nobody asked for.
export function formToPayload(values: StudentForm): Record<string, string | null> {
  const payload: Record<string, string | null> = {};
  for (const f of STUDENT_FIELDS) {
    const raw = values[f.name] ?? '';
    if (f.type === 'date') payload[f.name] = raw.trim() || null;
    else if (f.name === 'gender') payload[f.name] = normalizeGender(raw);
    else if (f.name === 'parent_phone') payload[f.name] = raw ? parsePhone(raw) : '';
    else payload[f.name] = raw.trim();
  }
  return payload;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// Field name to message, empty when the form can be sent. The server still has the last word.
export function validate(values: StudentForm): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of STUDENT_FIELDS) {
    const v = (values[f.name] ?? '').trim();
    if (f.required && !v) errors[f.name] = `${f.label} is required.`;
    else if (f.maxLength && v.length > f.maxLength) errors[f.name] = `${f.label} can be at most ${f.maxLength} characters.`;
    else if (f.type === 'date' && v && !isRealDate(v)) errors[f.name] = `${f.label} is not a valid date.`;
    else if (f.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.name] = 'Enter a valid email address.';
  }
  return errors;
}

// DRF returns { field: ["message"] } for a rejected save. This picks the messages that belong to
// a form field; anything else (non_field_errors, detail) comes back as `general`.
export function serverFieldErrors(data: unknown): { fields: Record<string, string>; general: string | null } {
  const fields: Record<string, string> = {};
  let general: string | null = null;
  if (!data || typeof data !== 'object') return { fields, general };
  const names = new Set(STUDENT_FIELDS.map((f) => f.name));
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const text = Array.isArray(value) ? value.map(String).join(' ') : typeof value === 'string' ? value : null;
    if (!text) continue;
    if (names.has(key)) fields[key] = text;
    else if (key === 'non_field_errors' || key === 'detail' || key === 'error') general = general ? `${general} ${text}` : text;
    else general = general ? `${general} ${key}: ${text}` : `${key}: ${text}`;
  }
  return { fields, general };
}

// Where the new student goes. A section (session class) carries its master class; a master-only
// option is the class itself. Mirrors what the web sends: class_obj always, session_class_id when
// the chosen option is a section.
export function placementPayload(option: { id: number; classObj: number | null; isSession: boolean } | null):
  { class_obj: number; session_class_id?: number } | null {
  if (!option) return null;
  const classId = option.classObj ?? option.id;
  return option.isSession ? { class_obj: classId, session_class_id: option.id } : { class_obj: classId };
}
