import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { financeApi, studentsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { buildSessionClassOptions, buildSessionOrMasterClassParams } from '../../utils/classScope'
import { schoolToday } from '../../utils/schoolTime'
import { getErrorMessage } from '../../utils/errorUtils'

/**
 * Billing for one fee category: everyone, or only enrolled students (Robotics, Karate, bus...).
 * For "enrolled only" it also lists who is enrolled and adds/ends enrollments. Joining mid-month is
 * charged the full month; ending stops the months after the end date. Bills already generated
 * never change here.
 *
 * kind: 'MONTHLY' | 'ANNUAL'.
 */
export default function OptionalFeeModal({ category, kind, onClose, canEdit = true }) {
  const queryClient = useQueryClient()
  const { activeAcademicYear } = useAcademicYear()
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const classOptions = useMemo(() => buildSessionClassOptions(sessionClasses), [sessionClasses])

  const categoryKey = kind === 'MONTHLY' ? 'monthly_category' : 'annual_category'
  const categoriesQueryKey = kind === 'MONTHLY' ? ['monthly-categories'] : ['annual-categories']
  const updateCategory = kind === 'MONTHLY' ? financeApi.updateMonthlyCategory : financeApi.updateAnnualCategory

  const [mode, setMode] = useState(category.billing_mode || 'ALL')
  const [price, setPrice] = useState(category.default_amount ?? '')
  const [status, setStatus] = useState('active')
  const [classId, setClassId] = useState('')
  const [picked, setPicked] = useState(new Set())
  const [startDate, setStartDate] = useState(schoolToday())
  const [studentPrice, setStudentPrice] = useState('')
  const [endDate, setEndDate] = useState(schoolToday())
  const [message, setMessage] = useState(null)

  const savedMode = category.billing_mode || 'ALL'
  const enrolledOnly = savedMode === 'ENROLLED'
  // Prices compare as numbers: the server sends "1500.00" for the "1500" just typed.
  const samePrice = (a, b) => (a === '' || a == null ? null : Number(a)) === (b === '' || b == null ? null : Number(b))
  const settingsChanged = mode !== savedMode || !samePrice(price, category.default_amount)

  const enrollmentsKey = ['fee-enrollments', categoryKey, category.id, status]
  const { data: enrollments = [], isLoading: enrollmentsLoading } = useQuery({
    queryKey: enrollmentsKey,
    queryFn: () => financeApi.getFeeEnrollments({ [categoryKey]: category.id, status }).then((r) => r.data),
    enabled: enrolledOnly,
  })

  const { data: classStudents = [], isLoading: studentsLoading } = useQuery({
    queryKey: ['students-for-fee-enroll', classId, activeAcademicYear?.id],
    queryFn: () => studentsApi.getStudents({
      ...buildSessionOrMasterClassParams({ classId, activeAcademicYearId: activeAcademicYear?.id, sessionClasses }),
      is_active: true, page_size: 9999,
    }).then((r) => r.data?.results ?? r.data ?? []),
    enabled: enrolledOnly && !!classId,
  })

  const activeIds = useMemo(
    () => new Set(enrollments.filter((e) => e.is_active || !e.end_date).map((e) => e.student)),
    [enrollments],
  )

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['fee-enrollments'] })
    queryClient.invalidateQueries({ queryKey: categoriesQueryKey })
  }

  const saveSettings = useMutation({
    mutationFn: () => updateCategory(category.id, {
      billing_mode: mode,
      default_amount: price === '' || price === null ? null : price,
    }),
    onSuccess: () => {
      refresh()
      setMessage({ ok: true, text: 'Billing saved. It applies to fees generated from now on.' })
    },
    onError: (err) => setMessage({ ok: false, text: getErrorMessage(err, 'Could not save.') }),
  })

  const enrollMutation = useMutation({
    mutationFn: () => financeApi.bulkEnrollFees({
      [categoryKey]: category.id,
      student_ids: [...picked],
      start_date: startDate,
      amount: studentPrice === '' ? null : studentPrice,
      academic_year: activeAcademicYear?.id,
    }),
    onSuccess: (res) => {
      const { created, skipped } = res.data
      setPicked(new Set())
      setStudentPrice('')
      refresh()
      setMessage({ ok: true, text: `${created} enrolled.${skipped ? ` ${skipped} already enrolled, skipped.` : ''}` })
    },
    onError: (err) => setMessage({ ok: false, text: getErrorMessage(err, 'Could not enroll.') }),
  })

  const endMutation = useMutation({
    mutationFn: (ids) => financeApi.endFeeEnrollments({ ids, end_date: endDate }),
    onSuccess: (res) => {
      refresh()
      setMessage({ ok: true, text: `${res.data.ended} enrollment(s) ended on ${endDate}.` })
    },
    onError: (err) => setMessage({ ok: false, text: getErrorMessage(err, 'Could not end.') }),
  })

  const togglePick = (id) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const pickable = classStudents.filter((s) => !activeIds.has(s.id))

  return (
    <Modal open onClose={onClose} title={`${category.name}: who pays?`} size="2xl" layer="top">
      <div className="space-y-5 text-sm">
        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            <label className="flex items-center gap-2">
              <input type="radio" name="billing" checked={mode === 'ALL'} disabled={!canEdit} onChange={() => setMode('ALL')} />
              All students <span className="text-gray-500">(price per class)</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="billing" checked={mode === 'ENROLLED'} disabled={!canEdit} onChange={() => setMode('ENROLLED')} />
              Enrolled students only <span className="text-gray-500">(e.g. Robotics, Karate)</span>
            </label>
          </div>
          {mode === 'ENROLLED' && (
            <label className="block max-w-xs">
              <span className="label">Price for every enrolled student (Rs)</span>
              <input
                type="number" min="0" className="input" value={price ?? ''} disabled={!canEdit}
                placeholder="e.g. 1500"
                onChange={(e) => setPrice(e.target.value)}
              />
              <span className="text-xs text-gray-500">Used when no class or student price is set in Fee Setup.</span>
            </label>
          )}
          {canEdit && settingsChanged && (
            <Button size="sm" onClick={() => { setMessage(null); saveSettings.mutate() }} disabled={saveSettings.isPending}>
              {saveSettings.isPending ? 'Saving…' : 'Save billing'}
            </Button>
          )}
        </section>

        {enrolledOnly && (
          <>
            <section className="border-t pt-4 dark:border-gray-700">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h3 className="font-semibold">Enrolled students</h3>
                <select className="input w-auto py-1" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show">
                  <option value="active">Current</option>
                  <option value="ended">Ended</option>
                  <option value="all">All</option>
                </select>
                {canEdit && status !== 'ended' && enrollments.length > 0 && (
                  <label className="ml-auto flex items-center gap-2 text-xs">
                    End date
                    <input type="date" className="input w-auto py-1" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </label>
                )}
              </div>
              {enrollmentsLoading ? (
                <p className="text-gray-500">Loading…</p>
              ) : enrollments.length === 0 ? (
                <p className="text-gray-500">Nobody yet. Add students below.</p>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded border dark:border-gray-700">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr><th className="p-2">Student</th><th className="p-2">Class</th><th className="p-2">From</th><th className="p-2">To</th><th className="p-2">Price</th><th className="p-2" /></tr>
                    </thead>
                    <tbody>
                      {enrollments.map((e) => (
                        <tr key={e.id} className="border-t dark:border-gray-700">
                          <td className="p-2">{e.student_name}</td>
                          <td className="p-2">{e.class_label}</td>
                          <td className="p-2">{e.start_date}</td>
                          <td className="p-2">{e.end_date || '—'}</td>
                          <td className="p-2">{e.amount ?? 'Default'}</td>
                          <td className="p-2 text-right">
                            {canEdit && !e.end_date && (
                              <button
                                type="button" className="text-red-600 hover:underline"
                                disabled={endMutation.isPending}
                                onClick={() => { setMessage(null); endMutation.mutate([e.id]) }}
                              >
                                End
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {canEdit && (
              <section className="border-t pt-4 dark:border-gray-700">
                <h3 className="mb-2 font-semibold">Add students</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="label">Class</span>
                    <select className="input" value={classId} onChange={(e) => { setClassId(e.target.value); setPicked(new Set()) }}>
                      <option value="">Pick a class</option>
                      {classOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="label">Starts on</span>
                    <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="label">Own price <span className="font-normal text-gray-400">(optional)</span></span>
                    <input type="number" min="0" className="input" value={studentPrice} placeholder="Default"
                      onChange={(e) => setStudentPrice(e.target.value)} />
                  </label>
                </div>
                {classId && (
                  studentsLoading ? <p className="mt-2 text-gray-500">Loading students…</p> : (
                    <div className="mt-3">
                      {pickable.length === 0 ? (
                        <p className="text-gray-500">Everyone in this class is already enrolled.</p>
                      ) : (
                        <>
                          <button
                            type="button" className="mb-2 text-xs text-blue-600 hover:underline"
                            onClick={() => setPicked(picked.size === pickable.length ? new Set() : new Set(pickable.map((s) => s.id)))}
                          >
                            {picked.size === pickable.length ? 'Clear all' : 'Select all'}
                          </button>
                          <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
                            {pickable.map((s) => (
                              <label key={s.id} className="flex items-center gap-2">
                                <input type="checkbox" checked={picked.has(s.id)} onChange={() => togglePick(s.id)} />
                                <span>{s.roll_number ? `${s.roll_number}. ` : ''}{s.name}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )
                )}
                <Button
                  className="mt-3" size="sm"
                  disabled={picked.size === 0 || !startDate || enrollMutation.isPending}
                  onClick={() => { setMessage(null); enrollMutation.mutate() }}
                >
                  {enrollMutation.isPending ? 'Enrolling…' : `Enroll ${picked.size || ''} student${picked.size === 1 ? '' : 's'}`}
                </Button>
              </section>
            )}
          </>
        )}

        {!enrolledOnly && mode === 'ENROLLED' && (
          <p className="text-xs text-gray-500">Save billing first, then add the students who take this fee.</p>
        )}
        {message && <p className={message.ok ? 'text-green-700' : 'text-red-600'}>{message.text}</p>}
      </div>
    </Modal>
  )
}
