// Mirrors StudentBulkCreateSerializer (backend/students/serializers.py): every row needs
// `roll_number` and `name`, and the call is capped at 100 rows. The setup wizard once sent
// first_name/last_name with no school_id, so the whole import 400'd; keep this in step with it.
export const BULK_MAX_ROWS = 100

// Each line: "roll_number, name[, parent_name[, parent_phone]]".
// Roll number comes first because the backend uses it to find existing students and overwrites them.
export function parseBulkStudents(text) {
  const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean)
  const students = []
  const problems = []
  const seen = new Set()

  if (lines.length > BULK_MAX_ROWS) {
    problems.push(`Too many lines (${lines.length}). Import at most ${BULK_MAX_ROWS} at a time.`)
  }

  lines.forEach((line, i) => {
    const [roll = '', name = '', parentName = '', parentPhone = ''] = line.split(',').map(s => s.trim())
    const n = i + 1
    if (!roll) { problems.push(`Line ${n}: roll number is missing.`); return }
    if (!name) { problems.push(`Line ${n}: name is missing.`); return }
    if (seen.has(roll)) { problems.push(`Line ${n}: roll number ${roll} appears twice.`); return }
    seen.add(roll)
    students.push({
      roll_number: roll,
      name,
      ...(parentName && { parent_name: parentName }),
      ...(parentPhone && { parent_phone: parentPhone }),
    })
  })

  return { students, problems }
}

export function buildBulkPayload({ schoolId, classId, sessionClassId, students }) {
  return {
    school_id: schoolId,
    class_id: parseInt(classId),
    ...(sessionClassId && { session_class_id: parseInt(sessionClassId) }),
    students,
  }
}

// DRF returns field errors ({students: [...]}), a string list, or {detail}; flatten to one message.
export function bulkErrorMessage(data) {
  if (!data) return 'Bulk import failed'
  if (typeof data === 'string') return data
  if (data.detail || data.error) return data.detail || data.error
  const flat = Object.values(data).flat(Infinity).map(v => (typeof v === 'string' ? v : JSON.stringify(v)))
  return flat.length ? flat.slice(0, 3).join(' ') : 'Bulk import failed'
}
