import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { examinationsApi } from '../../services/api'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import Spinner from '../../components/ui/Spinner'

const PROMOTION_OPTIONS = [
  { value: 'NOT_APPLICABLE', label: 'Not Applicable' },
  { value: 'PROMOTED', label: 'Promoted' },
  { value: 'NOT_PROMOTED', label: 'Not Promoted' },
]

const CAPTION_FIELDS = [
  { key: 'class_teacher', label: 'Class teacher' },
  { key: 'principal', label: 'Principal' },
  { key: 'parent', label: 'Parent' },
]

/**
 * Class-wide version of the report card's Edit mode: promotion per student, plus one issue
 * date and one set of signature captions applied to everyone listed. Marks, rank and
 * attendance stay computed, exactly as on the single-student card.
 */
export default function BulkReportCardModal({ students, yearId, examIds, onClose }) {
  const queryClient = useQueryClient()
  useEscapeKey(onClose, true)

  const studentIds = students.map(s => s.studentId)
  const { data: res, isLoading } = useQuery({
    queryKey: ['reportCardBulkMeta', yearId, examIds.join(','), studentIds.join(',')],
    queryFn: () => examinationsApi.getReportCardBulkMeta({
      academic_year_id: yearId,
      exam_ids: examIds.join(','),
      student_ids: studentIds.join(','),
    }),
  })
  const current = res?.data?.students || {}
  const anyApplicable = Object.values(current).some(v => v.promotion_applicable)

  const [promotions, setPromotions] = useState({})
  const [issueDate, setIssueDate] = useState('')
  const [labels, setLabels] = useState({ class_teacher: '', principal: '', parent: '' })
  const [overwrite, setOverwrite] = useState(true)
  const [error, setError] = useState('')

  // Seed the dropdowns from what is already saved, once it loads.
  useEffect(() => {
    if (!res) return
    const seeded = {}
    Object.entries(res.data.students).forEach(([id, v]) => { seeded[id] = v.promotion_status })
    setPromotions(seeded)
  }, [res])

  const setAll = (value) => {
    if (!value) return
    setPromotions(prev => {
      const next = { ...prev }
      Object.entries(current).forEach(([id, v]) => { if (v.promotion_applicable) next[id] = value })
      return next
    })
  }

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = { academic_year_id: yearId, exam_ids: examIds, student_ids: studentIds, overwrite }
      const applicable = Object.entries(current).filter(([, v]) => v.promotion_applicable)
      if (applicable.length) {
        payload.promotions = Object.fromEntries(applicable.map(([id]) => [id, promotions[id] || 'NOT_APPLICABLE']))
      }
      if (issueDate) payload.issue_date = issueDate
      const filled = Object.fromEntries(Object.entries(labels).filter(([, v]) => v.trim()))
      if (Object.keys(filled).length) payload.signature_labels = filled
      return examinationsApi.saveReportCardBulkMeta(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reportCard'] })
      queryClient.invalidateQueries({ queryKey: ['reportCardBulkMeta'] })
      onClose()
    },
    onError: (err) => setError(
      err.response?.data?.detail
      || Object.values(err.response?.data || {}).flat().join(' ')
      || 'Could not save.',
    ),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Class bulk edit</h2>
            <p className="text-xs text-gray-500">{students.length} students · saved against {res?.data?.main_exam?.name || 'the newest ticked exam'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl" aria-label="Close">&times;</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-5">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">Print details for everyone</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date of issue</label>
                <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="input w-full text-sm" />
              </div>
              {CAPTION_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{f.label} caption</label>
                  <input
                    type="text" maxLength={40} value={labels[f.key]} placeholder="Leave blank to keep as is"
                    onChange={e => setLabels(p => ({ ...p, [f.key]: e.target.value }))}
                    className="input w-full text-sm"
                  />
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 mt-3 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
              Overwrite dates, captions and promotions students already have
            </label>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-800">Promotion status</h3>
              {anyApplicable && (
                <select value="" onChange={e => setAll(e.target.value)} className="input text-sm">
                  <option value="">Set all to…</option>
                  {PROMOTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </div>
            {isLoading ? (
              <div className="py-6 text-center"><Spinner size="md" className="mx-auto" /></div>
            ) : !anyApplicable ? (
              <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
                Promotion only applies to a final exam. Make a final exam the newest one ticked (and mark its exam type as Final) to set it here.
              </p>
            ) : (
              <div className="border border-gray-100 rounded-lg divide-y divide-gray-100">
                {students.map(s => {
                  const meta = current[String(s.studentId)]
                  return (
                    <div key={s.studentId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-sm text-gray-800 truncate">
                        {s.name} <span className="text-gray-400">({s.roll})</span>
                      </span>
                      <select
                        value={promotions[String(s.studentId)] || 'NOT_APPLICABLE'}
                        disabled={!meta?.promotion_applicable}
                        onChange={e => setPromotions(p => ({ ...p, [String(s.studentId)]: e.target.value }))}
                        className="input text-sm w-40 disabled:opacity-50"
                      >
                        {PROMOTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <div className="flex justify-end gap-3 px-5 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button
            onClick={() => { setError(''); saveMut.mutate() }}
            disabled={saveMut.isPending || isLoading}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
          >
            {saveMut.isPending ? 'Saving...' : `Save for ${students.length} students`}
          </button>
        </div>
      </div>
    </div>
  )
}
