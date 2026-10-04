import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { formatDate, getApiErrorMessage } from './profileUtils'

// Changes a student's lifecycle status (left, transferred, suspended, ...). Mount
// only while open. When the chosen leaving date would strand attendance or marks,
// the server answers 400 records_after_leaving and this shows the conflict with the
// two ways out (use the suggested date, or remove the records).
export default function StatusUpdateModal({ student, onClose, onStartExit }) {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const [form, setForm] = useState({
    status: student.status || 'ACTIVE',
    status_date: student.status_date || '',
    status_reason: student.status_reason || '',
  })
  // Attendance/marks already recorded on or after the chosen leaving date
  // (server-side check); the admin picks a later date or removes them.
  const [conflict, setConflict] = useState(null)
  const [removeRecords, setRemoveRecords] = useState(false)

  useEscapeKey(onClose, true)

  const mutation = useMutation({
    mutationFn: (payload) => studentsApi.updateStudent(student.id, payload),
    onSuccess: (_res, payload) => {
      showSuccess(
        payload?.remove_records_after_leaving
          ? 'Student status updated; records after the leaving date were removed'
          : 'Student status updated successfully',
      )
      queryClient.invalidateQueries({ queryKey: ['student', String(student.id)] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      onClose()
    },
    onError: (error) => {
      const data = error?.response?.data
      if (data?.code === 'records_after_leaving') {
        setConflict(data)
        setRemoveRecords(false)
        return
      }
      showError(getApiErrorMessage(error, 'Failed to update student status'))
    },
  })

  // Leaving the school goes through the exit workflow (clearance checklist and
  // finalization), not a bare status change.
  const startsExit = ['WITHDRAWN', 'TRANSFERRED'].includes(form.status) && form.status !== student.status

  const handleSubmit = () => {
    if (!form.status) {
      showError('Status is required')
      return
    }
    if (startsExit && onStartExit) {
      onStartExit({ exit_type: form.status, leaving_date: form.status_date || '', reason: form.status_reason })
      return
    }
    mutation.mutate({
      status: form.status,
      status_date: form.status_date || null,
      status_reason: form.status_reason,
      ...(conflict && removeRecords ? { remove_records_after_leaving: true } : {}),
    })
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Update Student Status</h2>
          <p className="text-sm text-gray-500 mt-1">Use this for mid-session status changes (e.g. student left, transferred, suspended).</p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="status-update-status" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              id="status-update-status"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.status}
              onChange={(e) => {
                setForm((p) => ({ ...p, status: e.target.value }))
                setConflict(null)
              }}
            >
              <option value="ACTIVE">Active</option>
              <option value="WITHDRAWN">Withdrawn (Left school)</option>
              <option value="TRANSFERRED">Transferred (To another branch of this organization)</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="GRADUATED">Graduated</option>
              <option value="REPEAT">Repeat</option>
            </select>
          </div>
          {startsExit && onStartExit && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Leaving the school goes through a short checklist: pending fees, library books and gate passes are
              cleared or waived before the exit is finalized.
            </p>
          )}
          <div>
            <label htmlFor="status-update-date" className="block text-sm font-medium text-gray-700 mb-1">Effective Date</label>
            <input
              id="status-update-date"
              type="date"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.status_date}
              onChange={(e) => {
                setForm((p) => ({ ...p, status_date: e.target.value }))
                setConflict(null)
              }}
            />
          </div>
          {conflict && (
            <LeavingConflictNotice
              conflict={conflict}
              removeRecords={removeRecords}
              onToggleRemove={setRemoveRecords}
              onUseSuggestedDate={() => {
                setForm((p) => ({ ...p, status_date: conflict.suggested_leaving_date }))
                setConflict(null)
                setRemoveRecords(false)
              }}
            />
          )}
          <div>
            <label htmlFor="status-update-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <textarea
              id="status-update-reason"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.status_reason}
              onChange={(e) => setForm((p) => ({ ...p, status_reason: e.target.value }))}
              placeholder="Brief reason for status change"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={mutation.isPending || (conflict && !removeRecords)}
            className={`px-4 py-2 text-white rounded-lg disabled:opacity-50 ${
              conflict && removeRecords ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {mutation.isPending
              ? 'Saving...'
              : startsExit && onStartExit ? 'Continue to checklist'
              : conflict && removeRecords ? 'Remove Records & Save' : 'Save Status'}
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
