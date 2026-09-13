/**
 * Small bar sparkline for a record's recent history — used by LedgerCard for
 * Student/Child Fees (6-month paid/due trend) and Payroll (6-month net pay).
 * Each bar carries its own amount label underneath the month, per review
 * feedback — a bare colored bar without the number wasn't enough on its own.
 *
 * points: [{ label, value, tone? }] — tone ∈ 'success'|'warning'|'danger'|'neutral',
 *   defaults to 'neutral' (plain magnitude, e.g. payroll net pay).
 * currentLabel: outlines the bar matching this label (the current period).
 */
const TONE_CLASSES = {
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  danger: 'bg-red-500',
  neutral: 'bg-primary-400',
}

export default function TrendStrip({ points = [], currentLabel, formatValue = (v) => v.toLocaleString() }) {
  if (points.length === 0) return null
  const max = Math.max(...points.map((p) => p.value), 1)

  return (
    <div className="flex items-end gap-1.5 pt-1">
      {points.map((p, i) => {
        const heightPct = p.value === 0 ? 6 : Math.max(14, Math.round((p.value / max) * 100))
        const isCurrent = p.label === currentLabel
        return (
          <div key={i} className="flex-1 min-w-0 flex flex-col items-center gap-1">
            <span className="text-[9px] font-mono text-gray-500 truncate w-full text-center">
              {p.value > 0 ? formatValue(p.value) : '—'}
            </span>
            <div
              className={`w-full max-w-[20px] rounded-t ${TONE_CLASSES[p.tone] || TONE_CLASSES.neutral} ${
                isCurrent ? 'ring-2 ring-primary-500 ring-offset-1' : ''
              }`}
              style={{ height: `${heightPct * 0.36}px` }}
              title={`${p.label}: ${formatValue(p.value)}`}
            />
            <span className="text-[9px] font-mono text-gray-400">{p.label}</span>
          </div>
        )
      })}
    </div>
  )
}
