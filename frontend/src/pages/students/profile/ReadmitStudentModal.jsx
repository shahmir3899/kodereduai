import { useCallback, useMemo, useState } from 'react'
import Button from '../../../components/ui/Button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { studentsApi, studentExitsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { useAcademicYear } from '../../../contexts/AcademicYearContext'
import { useAuth } from '../../../contexts/AuthContext'
import { useSessionClasses } from '../../../hooks/useSessionClasses'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useRollSuggestion } from '../../../hooks/useRollSuggestion'
import { getErrorMessage } from '../../../utils/errorUtils'
import { formatDate } from './profileUtils'

const today = () => new Date().toISOString().slice(0, 10)

// Brings a withdrawn/transferred student back. It is the same student record, so
// every old attendance, mark and fee row stays; the months away stay empty. Returning
// in the year they left keeps their class and roll unless changed here; returning in
// a later year needs a class and roll. The return date may be in the future.
// Mount only while open.
export default function ReadmitStudentModal({ student, prefill = null, onClose }) {
  const queryClient = useQueryClient()
  const { showSuccess } = useToast()
  const { activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { sessionClasses, isLoading: classesLoading } = useSessionClasses(activeAcademicYear?.id)

  const [form, setForm] = useState({
    return_date: prefill?.return_date || today(),
    session_class: '',
    roll_number: '',
    reason: prefill?.reason || '',
  })
  const [rollTyped, setRollTyped] = useState(false)
  const [error, setError] = useState('')

  useEscapeKey(onClose, true)

  // When they left: the open break if there is one, else the date on their record.
  const awaySince = (student.away_periods || []).find((p) => !p.end)?.start || student.status_date

  const { data: rosterData } = useQuery({
    queryKey: ['studentReclassifyStudents', activeSchool?.id, activeAcademicYear?.id],
    queryFn: () => studentsApi.getStudents({
      school_id: activeSchool?.id,
      academic_year: activeAcademicYear?.id,
      page_size: 9999,
    }),
    enabled: !!activeAcademicYear?.id,
    staleTime: 60_000,
  })
  const roster = rosterData?.data?.results || rosterData?.data

  const targetClass = sessionClasses.find((sc) => String(sc.id) === String(form.session_class))
  const occupiedRolls = useMemo(() => {
    if (!form.session_class || !roster) return []
    return roster
      .filter((s) => {
        if (String(s.id) === String(student.id)) return false
        if (String(s.session_class_obj || '') === String(form.session_class)) return true
        return !!targetClass?.class_obj && String(s.class_obj || '') === String(targetClass.class_obj)
      })
      .map((s) => s.roll_number)
  }, [roster, targetClass, form.session_class, student.id])

  const autoFillRoll = useCallback((roll) => setForm((f) => ({ ...f, roll_number: roll })), [])
  const { recommendedRoll } = useRollSuggestion({
    enabled: true,
    // Not before the roster is in: suggesting from an empty list would fill in roll 1.
    hasClass: !!form.session_class && !!roster,
    occupiedRolls,
    currentRoll: form.roll_number,
    manuallyEdited: rollTyped,
    onAutoFill: autoFillRoll,
  })

  const mutation = useMutation({
    mutationFn: (payload) => studentExitsApi.readmit(payload),
    onSuccess: () => {
      showSuccess(`${student.name} has been re-admitted.`)
      const id = String(student.id)
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['studentProfileSummary', id] })
      queryClient.invalidateQueries({ queryKey: ['studentHistory', id] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      onClose()
    },
    onError: (err) => setError(err?.response?.data?.detail || getErrorMessage(err, 'Failed to re-admit the student')),
  })

  const handleSubmit = () => {
    setError('')
    if (!form.return_date) {
      setError('A return date is required.')
      return
    }
    mutation.mutate({
      student: student.id,
      return_date: form.return_date,
      session_class: form.session_class ? Number(form.session_class) : null,
      roll_number: form.roll_number.trim(),
      reason: form.reason.trim(),
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Re-admit student</h2>
          <p className="text-sm text-gray-500 mt-1">
            {student.name}{awaySince ? ` has been away since ${formatDate(awaySince)}` : ''}. Their earlier records stay;
            the time away stays empty.
          </p>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          <div>
            <label htmlFor="readmit-date" className="block text-sm font-medium text-gray-700 mb-1">Return date</label>
            <input
              id="readmit-date" type="date" className="input"
              value={form.return_date} onChange={(e) => setForm((f) => ({ ...f, return_date: e.target.value }))}
            />
            <p className="text-xs text-gray-500 mt-1">The first day back. It can be a date in the future.</p>
          </div>
          <div>
            <label htmlFor="readmit-class" className="block text-sm font-medium text-gray-700 mb-1">Class</label>
            <select
              id="readmit-class" className="input"
              value={form.session_class} disabled={classesLoading}
              onChange={(e) => {
                if (!form.roll_number.trim()) setRollTyped(false)
                setForm((f) => ({ ...f, session_class: e.target.value, roll_number: rollTyped ? f.roll_number : '' }))
              }}
            >
              <option value="">Keep their class (same year as they left)</option>
              {sessionClasses.map((sc) => {
                const label = sc.label || (sc.section ? `${sc.display_name || sc.name} - ${sc.section}` : (sc.display_name || sc.name))
                return <option key={sc.id} value={sc.id}>{label}</option>
              })}
            </select>
            <p className="text-xs text-gray-500 mt-1">Needed when they return in a later academic year.</p>
          </div>
          <div>
            <label htmlFor="readmit-roll" className="block text-sm font-medium text-gray-700 mb-1">Roll number</label>
            <input
              id="readmit-roll" className="input"
              placeholder="Keep their roll number"
              value={form.roll_number}
              onChange={(e) => {
                setRollTyped(true)
                setForm((f) => ({ ...f, roll_number: e.target.value }))
              }}
            />
            {recommendedRoll && form.session_class && (
              <p className="text-xs text-gray-500 mt-1">Next free roll in that class: {recommendedRoll}</p>
            )}
          </div>
          <div>
            <label htmlFor="readmit-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <textarea
              id="readmit-reason" rows={2} className="input"
              placeholder="Why they are coming back" value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button
 type="button" onClick={handleSubmit} disabled={mutation.isPending}
 
 >
            {mutation.isPending ? 'Re-admitting...' : 'Re-admit student'}
          </Button>
        </div>
      </div>
    </div>
  )
}
