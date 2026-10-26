import { useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { guideProgressApi } from '../../services/api'
import { useDebounce } from '../../hooks/useDebounce'
import Modal from '../ui/Modal'
import { Badge } from '../ui/Badge'
import guideData from '../../data/userGuide.json'
import videoData from '../../data/guideVideos.json'

const PAGE_SIZE = 10

const STATUS = {
  completed: { label: 'Completed', tone: 'success' },
  in_progress: { label: 'In progress', tone: 'info' },
  inactive: { label: 'Inactive 7+ days', tone: 'warning' },
  not_started: { label: 'Not started', tone: 'neutral' },
}

const ROLE_LABEL = {
  SCHOOL_ADMIN: 'School admin', PRINCIPAL: 'Principal', MANAGER: 'Manager', ACCOUNTANT: 'Accountant',
  TEACHER: 'Teacher', STAFF: 'Staff', PARENT: 'Parent', STUDENT: 'Student', DRIVER: 'Driver',
}

const SORTS = [
  ['name', 'Name'], ['-videos_percent', 'Most videos watched'], ['videos_percent', 'Fewest videos watched'],
  ['-last_seen', 'Seen most recently'], ['last_seen', 'Seen longest ago'],
]

const SECTION_TITLE = Object.fromEntries(guideData.chapters.flatMap((c) => c.sections.map((s) => [s.id, s.title.replace(/^Step \d+:\s*/, '')])))
const VIDEO_TITLE = Object.fromEntries(videoData.videos.map((v) => [v.id, v.title.en]))

const formatWhen = (iso) => {
  if (!iso) return 'Never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

function Tile({ label, value, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border px-3 py-2 text-left transition-colors ${active ? 'border-sky-400 bg-sky-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
    >
      <span className="block text-xl font-bold text-gray-900">{value}</span>
      <span className="block text-xs text-gray-500">{label}</span>
    </button>
  )
}

function ProgressBar({ percent, label }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${percent >= 100 ? 'bg-green-500' : 'bg-sky-500'}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs text-gray-600">{label}</span>
    </div>
  )
}

function StartCourse({ row }) {
  const done = row.steps_total > 0 && row.steps_done >= row.steps_total
  if (done) return <span className="mt-1 inline-block rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">Starting course completed ✓</span>
  return <span className="block text-xs text-gray-400">Starting course: {row.steps_done} of {row.steps_total} steps</span>
}

function DetailModal({ person, onClose }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['guideProgressUser', person.user_id],
    queryFn: () => guideProgressApi.userDetail(person.user_id).then((r) => r.data),
  })
  return (
    <Modal open onClose={onClose} title={`${person.name} · ${ROLE_LABEL[person.role] || person.role}`} size="lg">
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load this person's progress.</p>}
      {data && (
        <>
        <div className="mb-3 flex items-center gap-3">
          <ProgressBar percent={person.videos_percent} label={`${person.videos_watched} / ${person.videos_total} videos`} />
          <StartCourse row={person} />
        </div>
        <ol className="space-y-2">
          {data.steps.map((step, i) => (
            <li key={step.section} className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2">
              <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${step.done ? 'bg-green-600' : 'bg-gray-300'}`}>
                {step.done ? '✓' : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-gray-900">{SECTION_TITLE[step.section] || step.section}</span>
                <span className="block text-xs text-gray-500">
                  {step.video ? `Video: ${VIDEO_TITLE[step.video] || step.video}` : 'Read and ticked off'}
                  {step.video && !step.done && step.percent > 0 && ` · ${step.percent}% watched`}
                </span>
              </span>
              <span className="text-xs text-gray-400">{step.last_activity ? formatWhen(step.last_activity) : ''}</span>
            </li>
          ))}
          {data.steps.length === 0 && <p className="text-sm text-gray-500">No guide steps apply to this role.</p>}
        </ol>
        </>
      )}
    </Modal>
  )
}

/**
 * Who has gone through the user guide, for every login in this school (staff, teachers, parents, students).
 * Collapsed by default so the dashboard stays light; nothing is fetched until it is opened.
 */
export default function GuideProgressPanel() {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [group, setGroup] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [exporting, setExporting] = useState(false)
  const debounced = useDebounce(search, 300)

  const params = useMemo(() => {
    const p = { sort, page, page_size: PAGE_SIZE }
    if (debounced.trim()) p.search = debounced.trim()
    if (role) p.role = role
    if (group) p.group = group
    if (status) p.status = status
    return p
  }, [debounced, role, group, status, sort, page])

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['guideProgressOverview', params],
    queryFn: () => guideProgressApi.overview(params).then((r) => r.data),
    enabled: open,
    placeholderData: keepPreviousData,
  })

  const change = (setter) => (value) => { setter(value); setPage(1) }
  const summary = data?.summary
  const pages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1
  const noAccount = data?.no_account
  const filtered = Boolean(debounced.trim() || role || group || status)

  const exportCsv = async () => {
    setExporting(true)
    try {
      const { page: _page, page_size: _size, ...all } = params
      const res = await guideProgressApi.exportOverview(all)
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = 'guide-progress.csv'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const selectClass = 'rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500'

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:bg-gray-50"
      >
        <span>
          <span className="block text-sm font-semibold text-gray-900">User guide progress</span>
          <span className="block text-xs text-gray-500">Who has watched the Start here videos: staff, teachers, parents and students</span>
        </span>
        <svg className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {isError && <p className="text-sm text-red-600">Could not load guide progress. Try again in a moment.</p>}

          {summary && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Tile label="People tracked" value={summary.tracked} active={!status} onClick={() => change(setStatus)('')} />
              <Tile label="Completed" value={summary.completed} active={status === 'completed'} onClick={() => change(setStatus)('completed')} />
              <Tile label="In progress" value={summary.in_progress} active={status === 'in_progress'} onClick={() => change(setStatus)('in_progress')} />
              <Tile label="Not started" value={summary.not_started} active={status === 'not_started'} onClick={() => change(setStatus)('not_started')} />
              <Tile label="Inactive 7+ days" value={summary.inactive} active={status === 'inactive'} onClick={() => change(setStatus)('inactive')} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => change(setSearch)(e.target.value)}
              placeholder="Search name or username"
              aria-label="Search people"
              className={`${selectClass} w-full sm:w-64`}
            />
            <select aria-label="Role" value={role} onChange={(e) => change(setRole)(e.target.value)} className={selectClass}>
              <option value="">All roles</option>
              {(data?.filters?.roles || []).map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
            </select>
            <select aria-label="Class or department" value={group} onChange={(e) => change(setGroup)(e.target.value)} className={selectClass}>
              <option value="">All classes and departments</option>
              {(data?.filters?.groups || []).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select aria-label="Status" value={status} onChange={(e) => change(setStatus)(e.target.value)} className={selectClass}>
              <option value="">Any status</option>
              {Object.entries(STATUS).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
            </select>
            <select aria-label="Sort by" value={sort} onChange={(e) => change(setSort)(e.target.value)} className={selectClass}>
              {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            {filtered && (
              <button type="button" onClick={() => { setSearch(''); setRole(''); setGroup(''); setStatus(''); setPage(1) }} className="text-sm text-sky-600 hover:text-sky-700">
                Clear filters
              </button>
            )}
            <button type="button" onClick={exportCsv} disabled={exporting || !data?.count} className="ml-auto rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {exporting ? 'Preparing…' : 'Download CSV'}
            </button>
          </div>

          <div className={`overflow-x-auto rounded-xl border border-gray-200 bg-white ${isFetching && !isLoading ? 'opacity-70' : ''}`}>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Class / department</th>
                  <th className="px-3 py-2">Progress</th>
                  <th className="px-3 py-2">Last seen</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Loading…</td></tr>}
                {data?.results.map((row) => (
                  <tr key={row.user_id} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => setSelected(row)}>
                    <td className="px-3 py-2">
                      <button type="button" className="text-left font-medium text-gray-900 hover:text-sky-700" onClick={(e) => { e.stopPropagation(); setSelected(row) }}>{row.name}</button>
                      <span className="block text-xs text-gray-400">{row.username}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{ROLE_LABEL[row.role] || row.role}</td>
                    <td className="px-3 py-2 text-gray-700">{row.group || '—'}</td>
                    <td className="px-3 py-2">
                      <ProgressBar percent={row.videos_percent} label={`${row.videos_watched} / ${row.videos_total} videos`} />
                      <StartCourse row={row} />
                    </td>
                    <td className="px-3 py-2 text-gray-700">{formatWhen(row.last_seen)}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS[row.status]?.tone}>{STATUS[row.status]?.label || row.status}</Badge></td>
                  </tr>
                ))}
                {data && data.results.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">{filtered ? 'No one matches these filters.' : 'No one to show yet.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {data && data.count > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Page {data.page} of {pages} · {data.count} people</span>
              <span className="space-x-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-40">Previous</button>
                <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-40">Next</button>
              </span>
            </div>
          )}

          {noAccount && (noAccount.students > 0 || noAccount.staff > 0) && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Not tracked because they have no login yet: {noAccount.students} student{noAccount.students === 1 ? '' : 's'} and {noAccount.staff} staff member{noAccount.staff === 1 ? '' : 's'}.{' '}
              <Link to="/students" className="font-medium underline">Create accounts</Link>
            </p>
          )}
        </div>
      )}

      {selected && <DetailModal person={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
