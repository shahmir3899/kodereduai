import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import Field from '../../../components/ui/Field'
import Input from '../../../components/ui/Input'
import Textarea from '../../../components/ui/Textarea'
import { studentsApi } from '../../../services/api'

// The server takes at most 100 ids per call (StudentViewSet.BULK_DELETE_MAX).
const BATCH = 100
const PREVIEW = 10

const errorText = (err) => {
  const d = err?.response?.data
  return d?.detail || d?.error || err?.message || 'Could not remove the students.'
}

// Soft delete ("Remove, entered by mistake") for the ticked students: same effect as the single
// remove, so they appear in Recently deleted and an admin can restore them. The count has to be
// typed back, the many-student version of typing a name. Mount only while open.
export default function BulkDeleteStudentsModal({ students, onDone, onClose }) {
  const queryClient = useQueryClient()
  // The page clears its selection once students are removed; keep what this dialog was opened with.
  const [targets] = useState(students)
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const confirmed = typed.trim() === String(targets.length) && reason.trim().length > 0

  const handleRemove = async () => {
    setError('')
    setIsPending(true)
    const deleted = []
    const skipped = []
    try {
      for (let i = 0; i < targets.length; i += BATCH) {
        const ids = targets.slice(i, i + BATCH).map((s) => s.id)
        const res = await studentsApi.bulkDeleteStudents({ student_ids: ids, reason: reason.trim() })
        deleted.push(...(res.data?.deleted || []))
        skipped.push(...(res.data?.skipped || []))
      }
    } catch (err) {
      // A later batch failing leaves earlier ones removed; say so instead of implying nothing happened.
      setError(deleted.length ? `${errorText(err)} (${deleted.length} were already removed.)` : errorText(err))
    } finally {
      setIsPending(false)
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
    }
    if (deleted.length || skipped.length) {
      onDone?.(deleted)
      setResult({ deleted: deleted.length, skipped })
    }
  }

  if (result) {
    return (
      <Modal open onClose={onClose} title="Students removed" size="sm"
        footer={<Button onClick={onClose}>Done</Button>}>
        <p className="text-gray-700 dark:text-gray-200 mb-2">
          <strong>{result.deleted}</strong> student(s) removed. An admin can restore them from
          <em> Students &rsaquo; Recently deleted</em>.
        </p>
        {result.skipped.length > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <p className="font-medium">{result.skipped.length} could not be removed:</p>
            <ul className="list-disc pl-4 mt-1">
              {result.skipped.slice(0, PREVIEW).map((s) => (
                <li key={s.id}>{s.name || `Student ${s.id}`}: {s.detail}</li>
              ))}
              {result.skipped.length > PREVIEW && <li>…and {result.skipped.length - PREVIEW} more</li>}
            </ul>
          </div>
        )}
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={isPending ? undefined : onClose}
      title={`Remove ${targets.length} student(s)`}
      size="sm"
      closeOnBackdrop={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="danger" disabled={!confirmed} loading={isPending} onClick={handleRemove}>
            Remove {targets.length} student(s)
          </Button>
        </>
      )}
    >
      <p className="text-gray-600 dark:text-gray-300 mb-2">
        These students will be hidden from the portal. Their attendance, fees, marks and enrollments are kept, and a
        School Admin can bring them back from <em>Students &rsaquo; Recently deleted</em>.
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        Only use this for records entered by mistake. If students have left the school, use Status &amp; exit instead.
      </p>
      <ul className="text-sm text-gray-700 dark:text-gray-200 list-disc pl-5 mb-4 max-h-32 overflow-y-auto">
        {targets.slice(0, PREVIEW).map((s) => (
          <li key={s.id}>{s.name} (Roll #{s.roll_number})</li>
        ))}
        {targets.length > PREVIEW && <li>…and {targets.length - PREVIEW} more</li>}
      </ul>
      <div className="space-y-3">
        <Field label={`Type ${targets.length} to confirm`}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" inputMode="numeric" />
        </Field>
        <Field label="Reason (required)">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. test entries" />
        </Field>
      </div>
      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
    </Modal>
  )
}
