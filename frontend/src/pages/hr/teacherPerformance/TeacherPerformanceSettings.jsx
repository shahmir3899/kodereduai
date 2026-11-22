import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { teacherPerformanceApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import Button from '../../../components/ui/Button'
import LoadingState from '../../../components/ui/LoadingState'
import ErrorState from '../../../components/ui/ErrorState'
import { MEASURE_ORDER } from './shared'

const MEASURE_LABELS = {
  attendance_marking: 'Class attendance marked',
  lesson_plans: 'Lesson plans',
  marks_entry: 'Exam marks entered',
  own_attendance: 'Own attendance',
  homework: 'Homework and diary',
  grading: 'Homework grading',
  messages_answered: 'Messages answered',
  question_papers: 'Question papers created',
  book_content: 'Book content entered',
  login_days: 'Login days',
}

const NUMBER_FIELDS = [
  { key: 'marks_deadline_days', label: 'Marks entry deadline', unit: 'days after the paper' },
  { key: 'grading_deadline_days', label: 'Grading deadline', unit: 'days after submission' },
  { key: 'message_reply_hours', label: 'Message reply time', unit: 'hours' },
  { key: 'homework_per_week', label: 'Homework target', unit: 'per class-subject per week' },
  { key: 'papers_per_month', label: 'Question paper target', unit: 'per class-subject per month' },
  { key: 'content_blocks_per_month', label: 'Book content target', unit: 'blocks per month' },
]

const inputClass =
  'w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800'

/** Sum of the weights as the user typed them (blank counts as 0). Exported for the test. */
export function weightTotal(weights) {
  return MEASURE_ORDER.reduce((sum, k) => sum + (Number(weights?.[k]) || 0), 0)
}

function FieldError({ errors, name }) {
  const msg = errors?.[name]
  if (!msg) return null
  return <p className="mt-1 text-xs text-red-600">{Array.isArray(msg) ? msg.join(' ') : String(msg)}</p>
}

export default function TeacherPerformanceSettings() {
  const queryClient = useQueryClient()
  const { showSuccess } = useToast()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['teacher-performance', 'config'],
    queryFn: () => teacherPerformanceApi.getConfig().then((r) => r.data),
  })
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (data) setForm(structuredClone(data))
  }, [data])

  const total = useMemo(() => (form ? weightTotal(form.weights) : 0), [form])
  const totalOk = Math.round(total * 100) / 100 === 100

  const save = useMutation({
    mutationFn: (payload) => teacherPerformanceApi.updateConfig(payload),
    onSuccess: (res) => {
      setErrors({})
      queryClient.setQueryData(['teacher-performance', 'config'], res.data)
      // Weights, targets and deadlines change every score, and the info text.
      queryClient.invalidateQueries({ queryKey: ['teacher-performance'] })
      queryClient.invalidateQueries({ queryKey: ['teacher-performance-explainer'] })
      showSuccess('Teacher performance settings saved')
    },
    onError: (err) => setErrors(err.response?.data || { detail: 'Could not save.' }),
  })

  if (isLoading || !form) return <LoadingState label="Loading settings…" />
  if (isError) return <ErrorState onRetry={refetch} />

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const setWeight = (key, value) => setForm((f) => ({ ...f, weights: { ...f.weights, [key]: value } }))
  const setBand = (i, value) =>
    setForm((f) => ({ ...f, bands: f.bands.map((b, j) => (j === i ? { ...b, min: value } : b)) }))

  function submit(e) {
    e.preventDefault()
    if (!totalOk) return
    save.mutate({
      ...form,
      weights: Object.fromEntries(MEASURE_ORDER.map((k) => [k, Number(form.weights[k]) || 0])),
      bands: form.bands.map((b) => ({ ...b, min: Number(b.min) || 0 })),
    })
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Weights</h2>
        <p className="text-sm text-gray-500">
          How much each measure counts. They must total 100. A measure that does not apply to a teacher is left out and the rest are rescaled.
        </p>
        <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {MEASURE_ORDER.map((k) => (
            <label key={k} className="flex items-center justify-between gap-3 text-sm">
              <span>{MEASURE_LABELS[k]}</span>
              <input
                type="number" min="0" max="100" step="1" className={inputClass}
                aria-label={`${MEASURE_LABELS[k]} weight`}
                value={form.weights[k] ?? ''}
                onChange={(e) => setWeight(k, e.target.value)}
              />
            </label>
          ))}
        </div>
        <p
          role="status"
          className={`mt-3 text-sm font-medium tabular-nums ${totalOk ? 'text-green-700' : 'text-red-600'}`}
        >
          Total: {Math.round(total * 100) / 100} {totalOk ? '✓' : '— must be 100'}
        </p>
        <FieldError errors={errors} name="weights" />
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Deadlines and targets</h2>
        <div className="mt-3 space-y-3">
          <label className="flex flex-wrap items-center gap-3 text-sm">
            <span className="w-48">Attendance cut-off time</span>
            <input
              type="time" className={`${inputClass} w-32`} value={form.attendance_cutoff_time || ''}
              onChange={(e) => set('attendance_cutoff_time', e.target.value)}
            />
            <span className="text-gray-500">school time; later the same day earns half</span>
          </label>
          <FieldError errors={errors} name="attendance_cutoff_time" />
          {NUMBER_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="flex flex-wrap items-center gap-3 text-sm">
                <span className="w-48">{f.label}</span>
                <input
                  type="number" min="0" className={inputClass} value={form[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                />
                <span className="text-gray-500">{f.unit}</span>
              </label>
              <FieldError errors={errors} name={f.key} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Bands and visibility</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {form.bands.map((b, i) => (
            <label key={b.key} className="flex items-center justify-between gap-3 text-sm">
              <span>{b.label} from</span>
              <input
                type="number" min="0" max="100" className={inputClass} value={b.min}
                onChange={(e) => setBand(i, e.target.value)}
              />
            </label>
          ))}
        </div>
        <FieldError errors={errors} name="bands" />
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox" checked={!!form.show_rank_to_teachers}
            onChange={(e) => set('show_rank_to_teachers', e.target.checked)}
          />
          Show teachers their own position (e.g. “5th of 22”). They never see other teachers.
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          Teachers can see their own score
        </label>
      </section>

      {errors.detail && <p className="text-sm text-red-600">{String(errors.detail)}</p>}
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending} disabled={!totalOk}>Save settings</Button>
      </div>
    </form>
  )
}
