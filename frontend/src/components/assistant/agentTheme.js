// One colour per sub-agent, so a glance at the orb or a step line says WHO is working.
// Class names are written out in full because Tailwind only keeps classes it can find as literals.

export const AGENT_THEME = {
  finance: { label: 'Finance', dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-800 border-emerald-200', ring: 'border-emerald-500' },
  academics: { label: 'Academics', dot: 'bg-blue-500', pill: 'bg-blue-50 text-blue-800 border-blue-200', ring: 'border-blue-500' },
  attendance: { label: 'Attendance', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-800 border-amber-200', ring: 'border-amber-500' },
  communication: { label: 'Parent communication', dot: 'bg-fuchsia-500', pill: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200', ring: 'border-fuchsia-500' },
  study: { label: 'Study helper', dot: 'bg-violet-500', pill: 'bg-violet-50 text-violet-800 border-violet-200', ring: 'border-violet-500' },
}

const FALLBACK = { label: 'Assistant', dot: 'bg-slate-500', pill: 'bg-slate-50 text-slate-700 border-slate-200', ring: 'border-slate-400' }

export function themeFor(agent) {
  return AGENT_THEME[agent] || FALLBACK
}
