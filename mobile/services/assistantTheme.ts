// One colour per sub-agent so a glance at a step line says WHO is working. Same palette as the web orb.
export const AGENT_THEME: Record<string, { label: string; ring: string; fill: string; ink: string }> = {
  finance: { label: 'Finance', ring: '#10B981', fill: '#ECFDF5', ink: '#065F46' },
  academics: { label: 'Academics', ring: '#3B82F6', fill: '#EFF6FF', ink: '#1E40AF' },
  attendance: { label: 'Attendance', ring: '#F59E0B', fill: '#FFFBEB', ink: '#92400E' },
  communication: { label: 'Parent communication', ring: '#D946EF', fill: '#FDF4FF', ink: '#86198F' },
  exams: { label: 'Exams', ring: '#F43F5E', fill: '#FFF1F2', ink: '#9F1239' },
  students: { label: 'Students & admissions', ring: '#F97316', fill: '#FFF7ED', ink: '#9A3412' },
  operations: { label: 'Operations', ring: '#14B8A6', fill: '#F0FDFA', ink: '#115E59' },
  family: { label: 'My children', ring: '#EC4899', fill: '#FDF2F8', ink: '#9D174D' },
  hr: { label: 'HR', ring: '#06B6D4', fill: '#ECFEFF', ink: '#155E75' },
  study: { label: 'Study helper', ring: '#8B5CF6', fill: '#F5F3FF', ink: '#5B21B6' },
};

const FALLBACK = { label: 'Assistant', ring: '#94A3B8', fill: '#F1F5F9', ink: '#334155' };

export function themeFor(agent?: string) {
  return (agent && AGENT_THEME[agent]) || FALLBACK;
}
