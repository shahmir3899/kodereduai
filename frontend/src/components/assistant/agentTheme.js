// One colour per sub-agent, so a glance at the orb or a step line says WHO is working.
// `hex` colours are for the SVG orb (Tailwind classes cannot colour an SVG stroke from a variable).
// Class names are written out in full because Tailwind only keeps classes it can find as literals.

export const AGENT_THEME = {
  finance: { label: 'Finance', dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-800 border-emerald-200', ring: 'border-emerald-500', hex: { ring: '#10B981', fill: '#ECFDF5', ink: '#065F46' } },
  academics: { label: 'Academics', dot: 'bg-blue-500', pill: 'bg-blue-50 text-blue-800 border-blue-200', ring: 'border-blue-500', hex: { ring: '#3B82F6', fill: '#EFF6FF', ink: '#1E40AF' } },
  attendance: { label: 'Attendance', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-800 border-amber-200', ring: 'border-amber-500', hex: { ring: '#F59E0B', fill: '#FFFBEB', ink: '#92400E' } },
  communication: { label: 'Parent communication', dot: 'bg-fuchsia-500', pill: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200', ring: 'border-fuchsia-500', hex: { ring: '#D946EF', fill: '#FDF4FF', ink: '#86198F' } },
  exams: { label: 'Exams', dot: 'bg-rose-500', pill: 'bg-rose-50 text-rose-800 border-rose-200', ring: 'border-rose-500', hex: { ring: '#F43F5E', fill: '#FFF1F2', ink: '#9F1239' } },
  students: { label: 'Students & admissions', dot: 'bg-orange-500', pill: 'bg-orange-50 text-orange-800 border-orange-200', ring: 'border-orange-500', hex: { ring: '#F97316', fill: '#FFF7ED', ink: '#9A3412' } },
  operations: { label: 'Operations', dot: 'bg-teal-500', pill: 'bg-teal-50 text-teal-800 border-teal-200', ring: 'border-teal-500', hex: { ring: '#14B8A6', fill: '#F0FDFA', ink: '#115E59' } },
  settings: { label: 'My settings', dot: 'bg-slate-500', pill: 'bg-slate-50 text-slate-800 border-slate-200', ring: 'border-slate-500', hex: { ring: '#64748B', fill: '#F8FAFC', ink: '#334155' } },
  family: { label: 'My children', dot: 'bg-pink-500', pill: 'bg-pink-50 text-pink-800 border-pink-200', ring: 'border-pink-500', hex: { ring: '#EC4899', fill: '#FDF2F8', ink: '#9D174D' } },
  hr: { label: 'HR', dot: 'bg-cyan-500', pill: 'bg-cyan-50 text-cyan-800 border-cyan-200', ring: 'border-cyan-500', hex: { ring: '#06B6D4', fill: '#ECFEFF', ink: '#155E75' } },
  study: { label: 'Study helper', dot: 'bg-violet-500', pill: 'bg-violet-50 text-violet-800 border-violet-200', ring: 'border-violet-500', hex: { ring: '#8B5CF6', fill: '#F5F3FF', ink: '#5B21B6' } },
}

const FALLBACK = { label: 'Assistant', dot: 'bg-slate-500', pill: 'bg-slate-50 text-slate-700 border-slate-200', ring: 'border-slate-400', hex: { ring: '#94A3B8', fill: '#F1F5F9', ink: '#334155' } }

export function themeFor(agent) {
  return AGENT_THEME[agent] || FALLBACK
}
