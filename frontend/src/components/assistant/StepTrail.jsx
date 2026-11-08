import { useState } from 'react'
import { themeFor } from './agentTheme'

function Step({ step, showAgent }) {
  const theme = themeFor(step.sub_agent)
  const icon = step.status === 'running' ? '…' : step.status === 'ok' ? '✓' : '!'
  const iconTone = step.status === 'failed' ? 'text-red-600' : step.status === 'ok' ? 'text-emerald-600' : 'text-slate-400'
  return (
    <li className="flex items-center gap-2 text-xs text-slate-600">
      <span className={`h-2 w-2 shrink-0 rounded-full ${theme.dot}`} aria-hidden="true" />
      <span className={`w-3 text-center ${iconTone}`} aria-hidden="true">{icon}</span>
      <span>{step.label}</span>
      {showAgent && step.sub_agent && <span className="text-slate-400">· {theme.label}</span>}
      {step.status === 'failed' && <span className="sr-only">failed</span>}
    </li>
  )
}

/** Live while the assistant works; after the answer it folds into one line the user can open. */
export default function StepTrail({ steps, agents = [], live = false }) {
  const [open, setOpen] = useState(false)
  if (!steps.length && !live) return null

  if (live) {
    const names = agents.map((a) => themeFor(a).label).join(', ')
    return (
      <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2" aria-live="polite" data-testid="live-trail">
        <p className="mb-1 text-xs font-medium text-slate-700">{steps.length ? 'Working on it' : 'Thinking'}{names ? ` · ${names}` : ''}</p>
        {steps.length > 0 && <ul className="space-y-0.5">{steps.map((s) => <Step key={s.index} step={s} showAgent={new Set(steps.map((x) => x.sub_agent)).size > 1} />)}</ul>}
      </div>
    )
  }

  const failed = steps.filter((s) => s.ok === false).length
  return (
    <div className="mb-1">
      <button type="button" className="text-[11px] text-slate-500 hover:text-slate-700" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {steps.length} step{steps.length === 1 ? '' : 's'}{failed ? ` · ${failed} failed` : ''} {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {steps.map((s, i) => (
            <Step key={i} showAgent={new Set(steps.map((x) => x.sub_agent)).size > 1} step={{ index: i, label: s.label || s.name.replace(/_/g, ' '), sub_agent: s.sub_agent, status: s.ok ? 'ok' : 'failed' }} />
          ))}
        </ul>
      )}
    </div>
  )
}
