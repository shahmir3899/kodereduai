import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import LoadingState from '../../components/ui/LoadingState'
import { useAuth } from '../../contexts/AuthContext'
import { assistantApi } from '../../services/assistantApi'

const STATUS_LABELS = { new: 'New', planned: 'Planned', built: 'Built', wont_do: "Won't do" }
const STATUS_TONE = {
  new: 'bg-amber-50 text-amber-800 border-amber-200',
  planned: 'bg-blue-50 text-blue-800 border-blue-200',
  built: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  wont_do: 'bg-slate-100 text-slate-600 border-slate-200',
}
const KIND_LABELS = {
  missing_tool: 'No tool', tool_error: 'Error', denied: 'Not allowed', card_rejected: 'Card rejected',
  card_edited: 'Card edited', clarify_loop: 'Kept asking', thumbs_down: 'Thumbs down',
}

const top = (items) => (items || []).map((i) => `${i.key} (${i.count})`).join(', ') || '-'

function GroupDetail({ group, canEdit, schoolNames, onSave, saving }) {
  const [status, setStatus] = useState(group.status || 'new')
  const [note, setNote] = useState(group.note || '')
  return (
    <div className="grid gap-4 p-4 text-sm md:grid-cols-2">
      <div>
        <p className="mb-1 font-medium text-gray-800">Examples (names and numbers removed)</p>
        {group.examples.length ? (
          <ul className="list-disc space-y-1 pl-5 text-gray-700">
            {group.examples.map((e) => <li key={e} dir="auto">{e}</li>)}
          </ul>
        ) : (
          <p className="text-gray-500">No text was kept (students and parents, or errors).</p>
        )}
        <p className="mt-3 text-gray-600">Kinds: {top(group.kinds.map((k) => ({ ...k, key: KIND_LABELS[k.key] || k.key })))}</p>
        <p className="text-gray-600">Roles: {top(group.roles)}</p>
        <p className="text-gray-600">Agents: {top(group.agents)}</p>
        <p className="text-gray-600">Languages: {top(group.languages)}</p>
        {group.schools && (
          <p className="text-gray-600">
            Schools: {group.schools.map((s) => `${schoolNames[s.school_id] || `#${s.school_id}`} (${s.count})`).join(', ')}
          </p>
        )}
      </div>
      <div>
        {group.id === null ? (
          <p className="text-gray-500">{group.description}</p>
        ) : canEdit ? (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">
              Decision
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-gray-600">
              Note
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <button type="button" disabled={saving} onClick={() => onSave(group.id, { status, note })}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              Save
            </button>
          </div>
        ) : (
          group.note && <p className="text-gray-700" dir="auto">Note: {group.note}</p>
        )}
        {group.baseline_question_id && <p className="mt-2 text-xs text-gray-500">Baseline question: {group.baseline_question_id}</p>}
      </div>
    </div>
  )
}

export default function AuraInsightsPage() {
  const { isSuperAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState({ days: 30, kind: '', agent: '', status: '', school: '' })
  const [open, setOpen] = useState(null)

  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''))
  const { data, isLoading, error } = useQuery({
    queryKey: ['aura-insights', params],
    queryFn: () => assistantApi.getInsights(params).then((r) => r.data),
  })
  const save = useMutation({
    mutationFn: ([id, body]) => assistantApi.updateInsightGroup(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['aura-insights'] }),
  })

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }))
  const schoolNames = Object.fromEntries((data?.schools || []).map((s) => [s.id, s.name]))
  const select = 'rounded border border-gray-300 px-2 py-1.5 text-sm'

  if (error?.response?.status === 403) {
    return <p className="p-6 text-sm text-gray-600">Only admins can see Aura insights.</p>
  }

  return (
    <div className="mx-auto max-w-6xl p-4">
      <h1 className="text-xl font-semibold text-gray-900">Aura insights</h1>
      <p className="mb-4 text-sm text-gray-600">What people asked that Aura could not do yet. Names and numbers are removed.</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select aria-label="Period" value={filters.days} onChange={set('days')} className={select}>
          {(data?.filters?.days || [7, 30, 90]).map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <select aria-label="Kind" value={filters.kind} onChange={set('kind')} className={select}>
          <option value="">All kinds</option>
          {(data?.filters?.kinds || []).map((k) => <option key={k} value={k}>{KIND_LABELS[k] || k}</option>)}
        </select>
        <select aria-label="Status" value={filters.status} onChange={set('status')} className={select}>
          <option value="">All decisions</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input aria-label="Agent" placeholder="Agent" value={filters.agent} onChange={set('agent')} className={`${select} w-28`} />
        {isSuperAdmin && (
          <select aria-label="School" value={filters.school} onChange={set('school')} className={select}>
            <option value="">All schools</option>
            {(data?.schools || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {data && <span className="ml-auto text-xs text-gray-500">Thumbs: {data.satisfaction.up} up, {data.satisfaction.down} down</span>}
      </div>

      {isLoading ? (
        <LoadingState label="Loading insights..." />
      ) : !data?.groups?.length ? (
        <p className="rounded border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No gaps recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Request</th>
                <th className="px-3 py-2">Decision</th>
                <th className="px-3 py-2 text-right">7 days</th>
                <th className="px-3 py-2 text-right">30 days</th>
                <th className="px-3 py-2">Trend</th>
                <th className="px-3 py-2">Top role</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => {
                const key = g.id ?? 'ungrouped'
                return (
                  <Fragment key={key}>
                    <tr className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => setOpen(open === key ? null : key)}>
                      <td className="px-3 py-2 font-medium text-gray-900" dir="auto">{g.label}</td>
                      <td className="px-3 py-2">
                        {g.status ? <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[g.status]}`}>{STATUS_LABELS[g.status]}</span> : '-'}
                      </td>
                      <td className="px-3 py-2 text-right">{g.last_7_days}</td>
                      <td className="px-3 py-2 text-right">{g.last_30_days}</td>
                      <td className="h-10 w-28 px-3 py-1">
                        <ResponsiveContainer width="100%" height={28}>
                          <LineChart data={g.trend}><Line type="monotone" dataKey="count" stroke="#475569" strokeWidth={1.5} dot={false} isAnimationActive={false} /></LineChart>
                        </ResponsiveContainer>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{g.roles[0]?.key || '-'}</td>
                    </tr>
                    {open === key && (
                      <tr className="bg-gray-50">
                        <td colSpan={6}>
                          <GroupDetail group={g} canEdit={isSuperAdmin} schoolNames={schoolNames} saving={save.isPending}
                            onSave={(id, body) => save.mutate([id, body])} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
