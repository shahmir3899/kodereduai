import { Link } from 'react-router-dom'

/**
 * Amount-led card variant, for records where a number (not a name or status)
 * is the thing being scanned — Student/Child Fees, Payroll, Expenses. See
 * docs/CARD_SYSTEM.md for why these don't use RecordCard's identity-first
 * layout: a column of key/value pairs is the wrong shape for comparing amounts.
 *
 * Either pass `amount` (single figure, e.g. Expenses) or `breakdown`
 * (multiple mono columns with one emphasized as the total, e.g. Payroll's
 * Basic/Allowances/Deductions/Net or Student Fees' Due/Paid) — not both.
 *
 * amount: { value, tone? } — tone 'credit'|'debit'|'neutral' colors the figure.
 * breakdown: [{ label, value, tone?, emphasis? }] — rendered as a grid row;
 *   `emphasis` marks the one column (e.g. Net) that's larger/accented.
 * trend: <TrendStrip .../> or any node — rendered below the breakdown/amount.
 * footer: { label, value } — a trailing note like "Running balance".
 * actions: [{ label, onClick?, to?, tone?, disabled? }] — same shape as RecordCard.
 */
const AMOUNT_TONE_CLASSES = {
  credit: 'text-green-700',
  debit: 'text-red-700',
  neutral: 'text-gray-900',
}

const ACTION_TONE_CLASSES = {
  primary: 'text-primary-600 hover:text-primary-800',
  info: 'text-blue-600 hover:text-blue-800',
  accent: 'text-purple-600 hover:text-purple-800',
  danger: 'text-red-600 hover:text-red-800',
  success: 'text-green-600 hover:text-green-800',
  muted: 'text-gray-600 hover:text-gray-800',
}

function ActionItem({ action }) {
  const className = `text-xs font-medium ${ACTION_TONE_CLASSES[action.tone] || ACTION_TONE_CLASSES.primary} ${
    action.disabled ? 'opacity-50 pointer-events-none cursor-wait' : ''
  }`
  const stop = (e) => e.stopPropagation()
  if (action.to) {
    return <Link to={action.to} className={className} onClick={stop}>{action.label}</Link>
  }
  return (
    <button
      type="button"
      disabled={action.disabled}
      className={className}
      onClick={(e) => { stop(e); action.onClick?.(e) }}
    >
      {action.label}
    </button>
  )
}

export default function LedgerCard({
  title,
  meta,
  status,
  amount,
  breakdown,
  description,
  trend,
  footer,
  actions = [],
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm flex flex-col gap-2.5">
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-900 truncate">{title}</div>
          {meta && <div className="text-xs text-gray-500 mt-0.5 truncate">{meta}</div>}
        </div>
        {amount ? (
          <div className={`font-mono text-lg font-medium whitespace-nowrap ${AMOUNT_TONE_CLASSES[amount.tone] || AMOUNT_TONE_CLASSES.neutral}`}>
            {amount.tone === 'credit' && '+'}
            {amount.tone === 'debit' && '−'}
            {Number(amount.value).toLocaleString()}
          </div>
        ) : status}
      </div>

      {breakdown && breakdown.length > 0 && (
        <div className="grid gap-1.5 bg-gray-50 rounded-lg px-2.5 py-2" style={{ gridTemplateColumns: `repeat(${breakdown.length}, 1fr)` }}>
          {breakdown.map((b, i) => (
            <div key={i} className={i === 0 ? 'text-left' : 'text-right'}>
              <div className="text-[9px] uppercase tracking-wide text-gray-400">{b.label}</div>
              <div className={`font-mono text-xs ${b.emphasis ? 'text-sm font-semibold text-primary-700' : 'text-gray-800'} ${b.tone === 'debit' ? 'text-red-600' : ''}`}>
                {b.tone === 'debit' && '−'}{Number(b.value).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {amount && status && <div>{status}</div>}

      {description && <div className="text-xs text-gray-500 leading-relaxed">{description}</div>}

      {trend && (
        <div>
          <div className="text-[9px] uppercase tracking-wide text-gray-400 mb-0.5">Recent history</div>
          {trend}
        </div>
      )}

      {footer && (
        <div className="flex items-center justify-between text-xs text-gray-400 pt-1 border-t border-gray-100">
          <span>{footer.label}</span>
          <span className="font-mono text-gray-600">{Number(footer.value).toLocaleString()}</span>
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          {actions.map((a, i) => <ActionItem key={i} action={a} />)}
        </div>
      )}
    </div>
  )
}
