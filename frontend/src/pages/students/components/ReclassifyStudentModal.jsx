import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { useAcademicYear } from '../../../contexts/AcademicYearContext'
import { useAuth } from '../../../contexts/AuthContext'
import { useSessionClasses } from '../../../hooks/useSessionClasses'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useRollSuggestion } from '../../../hooks/useRollSuggestion'
import { getErrorMessage } from '../../../utils/errorUtils'

// Moves one student to another class for the active academic year (a correction,
// with an audit reason). Year-end moves go through the Promotion page. This is the
// only place a student's class changes: the edit forms show the class read-only.
// Mount only while open.
export default function ReclassifyStudentModal({ student, onClose }) {
  const queryClient = useQueryClient()
  const { showSuccess } = useToast()
  const { activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { sessionClasses, isLoading: classesLoading } = useSessionClasses(activeAcademicYear?.id)

  const [form, setForm] = useState({
    target_session_class_id: '',
    new_roll_number: student.roll_number || '',
    reason: '',
  })
  const [rollTyped, setRollTyped] = useState(false)
  const [error, setError] = useState('')

  useEscapeKey(onClose, true)

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

  const targetClass = sessionClasses.find((sc) => String(sc.id) === String(form.target_session_class_id))

  const occupiedRolls = useMemo(() => {
    if (!form.target_session_class_id || !roster) return []
    return roster
      .filter((s) => {
        if (String(s.id) === String(student.id)) return false
        if (String(s.session_class_obj || '') === String(form.target_session_class_id)) return true
        // Fallback for payloads without session_class_obj annotation
        if (!targetClass?.class_obj) return false
        return String(s.class_obj || '') === String(targetClass.class_obj)
      })
      .map((s) => s.roll_number)
  }, [roster, targetClass, form.target_session_class_id, student.id])

  const autoFillRoll = useCallback((roll) => setForm((p) => ({ ...p, new_roll_number: roll })), [])
  const { recommendedRoll } = useRollSuggestion({
    enabled: true,
    hasClass: !!form.target_session_class_id,
    occupiedRolls,
    currentRoll: form.new_roll_number,
    manuallyEdited: rollTyped,
    onAutoFill: autoFillRoll,
  })

  const mutation = useMutation({
    mutationFn: (payload) => studentsApi.reclassifyStudent(student.id, payload),
    onSuccess: () => {
      showSuccess('Student reclassified successfully')
      const id = String(student.id)
      queryClient.invalidateQueries({ queryKey: ['student', id] })
      queryClient.invalidateQueries({ queryKey: ['studentHistory', id] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['promotion-history'] })
      onClose()
    },
    onError: (err) => setError(err?.response?.data?.detail || getErrorMessage(err, 'Failed to reclassify student')),
  })

  const handleClassChange = (value) => {
    if (!form.new_roll_number?.trim()) setRollTyped(false)
    setForm((p) => ({
      ...p,
      target_session_class_id: value,
      new_roll_number: rollTyped ? p.new_roll_number : '',
    }))
  }

  const handleSubmit = () => {
    setError('')
    if (!activeAcademicYear?.id || !form.target_session_class_id) {
      setError('Selected academic year and target class are required')
      return
    }
    if (!form.reason.trim()) {
      setError('Reason is required')
      return
    }

    mutation.mutate({
      academic_year_id: Number(activeAcademicYear.id),
      target_session_class_id: Number(form.target_session_class_id),
      ...(targetClass?.class_obj && { target_class_id: Number(targetClass.class_obj) }),
      ...(form.new_roll_number.trim() && { new_roll_number: form.new_roll_number.trim() }),
      reason: form.reason.trim(),
    })
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-xl">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Reclassify Student</h2>
          <p className="text-sm text-gray-500 mt-1">Use this for single-student correction. For year-end transitions, use Promotion page.</p>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">Academic Year</span>
            <div className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-700">
              {activeAcademicYear?.name || 'No academic year selected'}
            </div>
          </div>
          <div>
            <label htmlFor="reclassify-class" className="block text-sm font-medium text-gray-700 mb-1">Target Class</label>
            <select
              id="reclassify-class"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.target_session_class_id}
              onChange={(e) => handleClassChange(e.target.value)}
              disabled={!activeAcademicYear?.id || classesLoading}
            >
              <option value="">Select class</option>
              {sessionClasses.map((sc) => {
                const label = sc.label || (sc.section ? `${sc.display_name || sc.name} - ${sc.section}` : (sc.display_name || sc.name))
                return <option key={sc.id} value={sc.id}>{label}</option>
              })}
            </select>
            {!activeAcademicYear?.id && (
              <p className="text-xs text-amber-600 mt-1">Pick an academic year from the top switcher to load session classes.</p>
            )}
          </div>
          <div>
            <label htmlFor="reclassify-roll" className="block text-sm font-medium text-gray-700 mb-1">New Roll Number (optional)</label>
            <input
              id="reclassify-roll"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.new_roll_number}
              onChange={(e) => {
                setRollTyped(true)
                setForm((p) => ({ ...p, new_roll_number: e.target.value }))
              }}
            />
            {recommendedRoll && form.target_session_class_id && (
              <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                <span>Suggested next roll: {recommendedRoll}</span>
                {String(form.new_roll_number || '').trim() !== String(recommendedRoll) && (
                  <button
                    type="button"
                    className="text-primary-600 hover:text-primary-700 font-medium"
                    onClick={() => {
                      setForm((p) => ({ ...p, new_roll_number: recommendedRoll }))
                      setRollTyped(true)
                    }}
                  >
                    Use suggested
                  </button>
                )}
              </div>
            )}
          </div>
          <div>
            <label htmlFor="reclassify-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <textarea
              id="reclassify-reason"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={form.reason}
              onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
              placeholder="Why this correction is required"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Applying...' : 'Apply Reclassification'}
          </button>
        </div>
      </div>
    </div>
  )
}
