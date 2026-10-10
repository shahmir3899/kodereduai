import { useState } from 'react'
import Button from '../../../components/ui/Button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { formatDate, getApiErrorMessage } from './profileUtils'

// The one entry point for taking a student off the roll. Each outcome has its own
// flow: leaving/transfer -> exit checklist, coming back -> re-admission, graduated
// and repeat -> a small confirmed change, and removing a student entered by mistake
// -> the typed-name delete. A bare status PATCH is refused by the server.
const OUTCOMES = {
  LEFT: { label: 'Left school', hint: 'Withdrawn. Goes through a short checklist: pending fees, library books and gate passes.' },
  TRANSFERRED: { label: 'Transferred', hint: 'Moves to another branch of this organization, with a new record there.' },
  READMIT: { label: 'Re-admit', hint: 'Coming back after leaving. You choose the class and roll; the time away is recorded.' },
  GRADUATED: { label: 'Graduated', hint: 'Completed the highest class. Still visible in the year they graduated.' },
  REPEAT: { label: 'Repeat', hint: 'Stays in the same class level next year.' },
  REMOVE: { label: 'Remove (entered by mistake)', hint: 'Hides the record. An admin can restore it from Recently deleted.' },
}

const needsDate = (outcome) => ['LEFT', 'TRANSFERRED', 'READMIT'].includes(outcome)

export default function StatusUpdateModal({ student, onClose, onStartExit, onStartReadmit, onStartRemove }) {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const [outcome, setOutcome] = useState('')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')

  useEscapeKey(onClose, true)

  const { data, isLoading } = useQuery({
    queryKey: ['removal-preview', student.id],
    queryFn: () => studentsApi.getRemovalPreview(student.id),
  })
  const preview = data?.data
  const allowed = preview?.allowed_outcomes || []

  const mutation = useMutation({
    mutationFn: (payload) => studentsApi.setStudentOutcome(student.id, payload),
    onSuccess: (_res, payload) => {
      showSuccess(payload.outcome === 'GRADUATED' ? 'Marked as graduated' : 'Marked as repeating')
      queryClient.invalidateQueries({ queryKey: ['student', String(student.id)] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['removal-preview', student.id] })
      onClose()
    },
    onError: (error) => showError(getApiErrorMessage(error, 'Failed to update student status')),
  })

  const counts = preview?.counts || {}
  const recordSummary = [
    counts.attendance ? `${counts.attendance} attendance` : null,
    counts.fees ? `${counts.fees} fee` : null,
    counts.marks ? `${counts.marks} marks` : null,
    counts.enrollments ? `${counts.enrollments} enrollment` : null,
    counts.other ? `${counts.other} other` : null,
  ].filter(Boolean).join(', ')

  const submitLabel = {
    LEFT: 'Continue to checklist',
    TRANSFERRED: 'Continue to checklist',
    READMIT: 'Continue to re-admission',
    GRADUATED: 'Mark as graduated',
    REPEAT: 'Mark as repeat',
    REMOVE: 'Continue to remove',
  }[outcome] || 'Continue'

  const handleSubmit = () => {
    if (!outcome) {
      showError('Choose what happened to the student')
      return
    }
    if (!reason.trim()) {
      showError('A reason is required')
      return
    }
    if (outcome === 'READMIT') return onStartReadmit?.({ return_date: date, reason: reason.trim() })
    if (outcome === 'LEFT') return onStartExit?.({ exit_type: 'WITHDRAWN', leaving_date: date, reason: reason.trim() })
    if (outcome === 'TRANSFERRED') return onStartExit?.({ exit_type: 'TRANSFERRED', leaving_date: date, reason: reason.trim() })
    if (outcome === 'REMOVE') return onStartRemove?.(reason.trim())
    mutation.mutate({ outcome, reason: reason.trim() })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Status &amp; exit</h2>
          <p className="text-sm text-gray-500 mt-1">What happened to {student.name}?</p>
        </div>

        <div className="p-6 space-y-4">
          {isLoading && <p className="text-sm text-gray-500">Loading options…</p>}
          <div className="space-y-2" role="radiogroup" aria-label="Outcome">
            {allowed.map((key) => (
              <label
                key={key}
                className={`flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer ${
                  outcome === key ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="student-outcome"
                  className="mt-1"
                  checked={outcome === key}
                  onChange={() => setOutcome(key)}
                />
                <span>
                  <span className="font-medium text-gray-900">{OUTCOMES[key]?.label || key}</span>
                  <span className="block text-xs text-gray-600">{OUTCOMES[key]?.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {outcome === 'REMOVE' && (
            <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {preview?.has_history
                ? `${student.name} has records (${recordSummary}). They are kept, but if the student actually attended, choose Left school instead.`
                : `${student.name} has no records, so they can also be erased for good from Recently deleted.`}
            </p>
          )}

          {needsDate(outcome) && (
            <div>
              <label htmlFor="status-update-date" className="block text-sm font-medium text-gray-700 mb-1">
                {outcome === 'READMIT' ? 'Return date' : 'Effective date'}
              </label>
              <input
                id="status-update-date"
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          )}

          <div>
            <label htmlFor="status-update-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <textarea
              id="status-update-reason"
              rows={3}
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Brief reason (required)"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={mutation.isPending || !outcome}
            className={`px-4 py-2 text-white rounded-lg disabled:opacity-50 ${
              outcome === 'REMOVE' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {mutation.isPending ? 'Saving...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function LeavingConflictNotice({ conflict, removeRecords, onToggleRemove, onUseSuggestedDate }) {
  const att = conflict.attendance || {}
  const marks = conflict.marks || {}
  const total = (att.count || 0) + (marks.count || 0)
  const attParts = [
    att.present ? `${att.present} present` : null,
    att.absent ? `${att.absent} absent` : null,
    att.leave ? `${att.leave} on leave` : null,
  ].filter(Boolean).join(', ')

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 space-y-3">
      <div>
        <p className="font-semibold">Records exist after this leaving date</p>
        <p className="mt-1">
          {conflict.student_name} still has records on or after <strong>{formatDate(conflict.leaving_date)}</strong>,
          the leaving date you chose. A student can&apos;t have attendance or exam marks after they leave, so
          this date can&apos;t be saved as it is.
        </p>
      </div>

      <ul className="list-disc pl-5 space-y-1">
        {att.count > 0 && (
          <li>
            <strong>{att.count} attendance record{att.count === 1 ? '' : 's'}</strong>{' '}
            from {formatDate(att.first_date)} to {formatDate(att.last_date)}
            {attParts ? ` (${attParts})` : ''}
          </li>
        )}
        {(marks.exams || []).map((exam) => (
          <li key={exam.id}>
            <strong>{exam.count} exam mark{exam.count === 1 ? '' : 's'}</strong> in {exam.name}
            {exam.entered < exam.count ? ` (${exam.entered} entered, ${exam.count - exam.entered} blank)` : ''}
          </li>
        ))}
      </ul>

      <p>
        The last recorded day is <strong>{formatDate(conflict.last_record_date)}</strong>. Choose one:
      </p>

      <div className="space-y-2">
        <button
          type="button"
          onClick={onUseSuggestedDate}
          className="w-full text-left px-3 py-2 rounded-lg border border-amber-400 bg-white hover:bg-amber-100"
        >
          <span className="font-medium">Use {formatDate(conflict.suggested_leaving_date)} as the leaving date</span>
          <span className="block text-xs text-amber-800">
            Keeps all records. Pick this if the student really attended until {formatDate(conflict.last_record_date)}.
          </span>
        </button>

        <label className="flex items-start gap-2 px-3 py-2 rounded-lg border border-red-300 bg-white cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={removeRecords}
            onChange={(e) => onToggleRemove(e.target.checked)}
          />
          <span>
            <span className="font-medium text-red-700">
              Keep {formatDate(conflict.leaving_date)} and remove these {total} record{total === 1 ? '' : 's'}
            </span>
            <span className="block text-xs text-gray-600">
              Pick this if the records were entered by mistake. A copy is saved in the admin audit log before
              they are deleted.
            </span>
          </span>
        </label>
      </div>
    </div>
  )
}
