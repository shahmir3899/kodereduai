import { useEffect, useState } from 'react'
import Button from '../../../components/ui/Button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { useAcademicYear } from '../../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../../hooks/useSessionClasses'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { getErrorMessage } from '../../../utils/errorUtils'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const today = () => new Date().toISOString().slice(0, 10)

// Moves one student to another class (master class and section together) from a
// chosen date: days before it stay with the old class, days from it belong to the new
// one. The roll is the lowest free number in the new section unless one is typed.
// Moving to a different master class also shows the fee impact. Mount only while open.
export default function ReclassifyStudentModal({ student, onClose }) {
  const queryClient = useQueryClient()
  const { showSuccess } = useToast()
  const { activeAcademicYear } = useAcademicYear()
  const { sessionClasses, isLoading: classesLoading } = useSessionClasses(activeAcademicYear?.id)

  const [form, setForm] = useState({
    target_session_class_id: '',
    effective_date: today(),
    new_roll_number: '',
    reason: '',
    fee_option: 'keep',
  })
  const [rollTyped, setRollTyped] = useState(false)
  const [error, setError] = useState('')

  useEscapeKey(onClose, true)

  const ready = !!activeAcademicYear?.id && !!form.target_session_class_id && !!form.effective_date
  const { data: previewData, isFetching: previewLoading } = useQuery({
    queryKey: ['reclassify-preview', student.id, activeAcademicYear?.id, form.target_session_class_id, form.effective_date],
    queryFn: () => studentsApi.getReclassifyPreview(student.id, {
      academic_year_id: activeAcademicYear.id,
      target_session_class_id: form.target_session_class_id,
      effective_date: form.effective_date,
    }),
    enabled: ready,
  })
  const preview = ready ? previewData?.data : undefined
  const fees = preview?.fees
  const warnings = preview?.warnings || {}
  // A different master class with no fee set on either side and nothing generated has nothing to decide.
  const showFees = !!fees?.applies && fees.categories.some((c) => c.old_fee !== c.new_fee || c.months_from_move.length > 0)

  // Fill in the server's lowest free roll until the admin types their own.
  useEffect(() => {
    if (preview?.suggested_roll && !rollTyped) {
      setForm((p) => (p.new_roll_number === preview.suggested_roll ? p : { ...p, new_roll_number: preview.suggested_roll }))
    }
  }, [preview?.suggested_roll, rollTyped])

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

  const targetClass = sessionClasses.find((sc) => String(sc.id) === String(form.target_session_class_id))

  const handleClassChange = (value) => {
    setRollTyped(false)
    setForm((p) => ({ ...p, target_session_class_id: value, new_roll_number: '', fee_option: 'keep' }))
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
      effective_date: form.effective_date,
      ...(showFees && { fee_option: form.fee_option }),
      reason: form.reason.trim(),
    })
  }

  const fromMonth = fees?.from_month ? `${MONTHS[fees.from_month.month - 1]} ${fees.from_month.year}` : ''
  const warningLines = [
    warnings.attendance_since ? `${warnings.attendance_since} attendance record(s) dated on or after this day will show under the new class.` : null,
    warnings.fee_rows_since ? `${warnings.fee_rows_since} monthly fee row(s) from this month on are already generated.` : null,
    warnings.marks_in_year ? `${warnings.marks_in_year} exam mark(s) this year stay with their exams.` : null,
  ].filter(Boolean)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Reclassify Student</h2>
          <p className="text-sm text-gray-500 mt-1">Moves the student to another class from a date. For year-end transitions, use the Promotion page.</p>
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
              className="input"
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
            <label htmlFor="reclassify-date" className="block text-sm font-medium text-gray-700 mb-1">Effective date</label>
            <input
              id="reclassify-date"
              type="date"
              className="input"
              value={form.effective_date}
              onChange={(e) => setForm((p) => ({ ...p, effective_date: e.target.value, fee_option: 'keep' }))}
            />
            <p className="text-xs text-gray-500 mt-1">The first day in the new class. Earlier days stay with the old class.</p>
          </div>
          <div>
            <label htmlFor="reclassify-roll" className="block text-sm font-medium text-gray-700 mb-1">New Roll Number (optional)</label>
            <input
              id="reclassify-roll"
              className="input"
              value={form.new_roll_number}
              onChange={(e) => {
                setRollTyped(true)
                setForm((p) => ({ ...p, new_roll_number: e.target.value }))
              }}
            />
            {preview?.suggested_roll && (
              <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                <span>Lowest free roll: {preview.suggested_roll}</span>
                {String(form.new_roll_number || '').trim() !== String(preview.suggested_roll) && (
                  <button
                    type="button"
                    className="text-primary-600 hover:text-primary-700 font-medium"
                    onClick={() => {
                      setForm((p) => ({ ...p, new_roll_number: preview.suggested_roll }))
                      setRollTyped(false)
                    }}
                  >
                    Use suggested
                  </button>
                )}
              </div>
            )}
          </div>

          {ready && previewLoading && !preview && <p className="text-sm text-gray-500">Checking records and fees…</p>}

          {warningLines.length > 0 && (
            <div role="note" className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
              {warningLines.map((line) => <p key={line}>{line}</p>)}
            </div>
          )}

          {showFees && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-3 text-sm">
              <p className="font-medium text-gray-900">Fees: a different class has a different fee</p>
              <ul className="space-y-1 text-gray-700">
                {fees.categories.filter((c) => c.old_fee !== c.new_fee).map((c) => (
                  <li key={c.category_id}>
                    {c.name}: {c.old_fee ?? 'no fee'} &rarr; {c.new_fee ?? 'no fee'}
                    {c.student_override ? ' (this student has their own fee, which stays)' : ''}
                  </li>
                ))}
              </ul>
              <div className="space-y-2" role="radiogroup" aria-label="Fee option">
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="fee-option"
                    className="mt-1"
                    checked={form.fee_option === 'keep'}
                    onChange={() => setForm((p) => ({ ...p, fee_option: 'keep' }))}
                  />
                  <span>
                    <span className="font-medium">Keep generated months as they are</span>
                    <span className="block text-xs text-gray-600">The new fee applies to months not generated yet.</span>
                  </span>
                </label>
                <label className={`flex items-start gap-2 ${fees.can_reprice ? '' : 'opacity-60'}`}>
                  <input
                    type="radio"
                    name="fee-option"
                    className="mt-1"
                    disabled={!fees.can_reprice}
                    checked={form.fee_option === 'reprice'}
                    onChange={() => setForm((p) => ({ ...p, fee_option: 'reprice' }))}
                  />
                  <span>
                    <span className="font-medium">Re-price unpaid months from {fromMonth}</span>
                    <span className="block text-xs text-gray-600">Carried balances are rebuilt. Paid months are never changed.</span>
                  </span>
                </label>
                {fees.blockers.length > 0 && (
                  <ul className="text-xs text-amber-800 list-disc pl-5">
                    {fees.blockers.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                )}
              </div>
              <p className="text-xs text-gray-500">{fees.annual_note}</p>
            </div>
          )}

          <div>
            <label htmlFor="reclassify-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <textarea
              id="reclassify-reason"
              rows={3}
              className="input"
              value={form.reason}
              onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
              placeholder="Why this move is required"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Applying...' : 'Apply Reclassification'}
          </Button>
        </div>
      </div>
    </div>
  )
}
