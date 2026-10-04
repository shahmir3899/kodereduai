// Single source of truth for the student form: both the list-page modal and the
// profile-page section cards render from this, so a field added here shows up in
// both. Limits mirror students.models.Student.

export const STUDENT_SECTIONS = [
  { key: 'basic', label: 'Basic' },
  { key: 'personal', label: 'Personal' },
  { key: 'guardian', label: 'Guardian' },
  { key: 'admission', label: 'Admission' },
]

export const GENDER_OPTIONS = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'O', label: 'Other' },
]

// type: text | textarea | date | email | tel | select
// kind: how formToPayload normalizes the value (see studentFormUtils)
// quick: shown in the compact Add Student form; everything else sits behind "more fields"
export const STUDENT_FIELDS = [
  { name: 'name', label: 'Student name', section: 'basic', type: 'text', required: true, quick: true, maxLength: 200 },
  { name: 'roll_number', label: 'Roll number', section: 'basic', type: 'text', required: true, quick: true, maxLength: 20 },

  { name: 'date_of_birth', label: 'Date of birth', section: 'personal', type: 'date', kind: 'date' },
  { name: 'gender', label: 'Gender', section: 'personal', type: 'select', kind: 'gender', options: GENDER_OPTIONS },
  { name: 'blood_group', label: 'Blood group', section: 'personal', type: 'text', maxLength: 5 },
  { name: 'address', label: 'Address', section: 'personal', type: 'textarea' },

  // Parent and guardian overlap today (merged in a later phase); both stay editable meanwhile.
  { name: 'parent_name', label: 'Parent name', section: 'guardian', type: 'text', quick: true, maxLength: 200 },
  {
    name: 'parent_phone', label: 'Parent phone', section: 'guardian', type: 'tel', kind: 'phone', phone: true, quick: true,
    maxLength: 20, placeholder: '+923001234567',
    hint: 'Use +92 format (e.g. +923001234567) for WhatsApp notifications',
  },
  { name: 'guardian_name', label: 'Guardian name', section: 'guardian', type: 'text', maxLength: 200 },
  { name: 'guardian_relation', label: 'Guardian relation', section: 'guardian', type: 'text', maxLength: 50 },
  { name: 'guardian_phone', label: 'Guardian phone', section: 'guardian', type: 'tel', phone: true, maxLength: 20 },
  { name: 'guardian_email', label: 'Guardian email', section: 'guardian', type: 'email' },
  { name: 'guardian_occupation', label: 'Guardian occupation', section: 'guardian', type: 'text', maxLength: 100 },
  { name: 'guardian_address', label: 'Guardian address', section: 'guardian', type: 'textarea' },
  { name: 'emergency_contact', label: 'Emergency contact', section: 'guardian', type: 'tel', phone: true, maxLength: 20 },

  { name: 'admission_number', label: 'Admission number', section: 'admission', type: 'text', maxLength: 30 },
  { name: 'admission_date', label: 'Admission date', section: 'admission', type: 'date', kind: 'date' },
  { name: 'previous_school', label: 'Previous school', section: 'admission', type: 'text', maxLength: 200 },
]

export const STUDENT_FIELD_NAMES = STUDENT_FIELDS.map((f) => f.name)

export const fieldsInSection = (sectionKey) => STUDENT_FIELDS.filter((f) => f.section === sectionKey)
