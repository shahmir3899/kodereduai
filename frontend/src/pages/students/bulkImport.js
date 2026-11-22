import { studentsApi } from '../../services/api'

// The server accepts at most 100 students per bulk_create call (StudentBulkCreateSerializer): each row is
// saved one by one against a remote database, so one huge call could hit the request timeout and fail
// halfway. Callers never see the cap; a 400-student school is just four calls.
export const BULK_BATCH_SIZE = 100

const errorText = (data) => {
  if (!data) return 'Request failed'
  if (typeof data === 'string') return data
  if (data.detail || data.error) return data.detail || data.error
  const flat = Object.values(data).flat(Infinity).map(v => (typeof v === 'string' ? v : JSON.stringify(v)))
  return flat.length ? flat.slice(0, 3).join(' ') : 'Request failed'
}

// studentsByClass keys are "classId" or "classId:sessionClassId" (see parseStudentRows).
// Keeps going after a failed batch so one bad class can't block the rest, and hands back
// `failedRows` in the same shape so the caller can let the user fix the file and retry just those.
// Retrying already-saved rows is harmless: a matching roll number updates rather than duplicates.
export async function importStudentsInBatches({ schoolId, studentsByClass, labelFor = (k) => k, onProgress }) {
  const total = Object.values(studentsByClass).reduce((n, rows) => n + rows.length, 0)
  let added = 0
  let updated = 0
  let done = 0
  const failures = []
  const failedRows = {}

  for (const [key, rows] of Object.entries(studentsByClass)) {
    const [classId, sessionClassId] = key.split(':')
    for (let i = 0; i < rows.length; i += BULK_BATCH_SIZE) {
      const batch = rows.slice(i, i + BULK_BATCH_SIZE)
      try {
        const res = await studentsApi.bulkCreateStudents({
          school_id: schoolId,
          class_id: parseInt(classId),
          ...(sessionClassId && { session_class_id: parseInt(sessionClassId) }),
          students: batch,
        })
        added += res.data?.created_count || 0
        updated += res.data?.updated_count || 0
        const rowErrors = res.data?.errors || []
        rowErrors.forEach(e => failures.push(`${labelFor(key)}, roll ${e.roll_number}: ${e.error}`))
        const badRolls = new Set(rowErrors.map(e => String(e.roll_number)))
        const bad = batch.filter(s => badRolls.has(String(s.roll_number)))
        if (bad.length) (failedRows[key] ||= []).push(...bad)
      } catch (err) {
        failures.push(`${labelFor(key)} (${batch.length} students, starting roll ${batch[0].roll_number}): ${errorText(err.response?.data)}`)
        ;(failedRows[key] ||= []).push(...batch)
      }
      done += batch.length
      onProgress?.({ done, total })
    }
  }

  return { added, updated, failures, failedRows, failedCount: Object.values(failedRows).flat().length }
}

export const batchCount = (studentsByClass) =>
  Object.values(studentsByClass).reduce((n, rows) => n + Math.ceil(rows.length / BULK_BATCH_SIZE), 0)
