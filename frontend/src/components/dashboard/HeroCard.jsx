import { Link } from 'react-router-dom'

const TONE = {
  sky: 'from-sky-50 to-white border-sky-200',
  green: 'from-green-50 to-white border-green-200',
  amber: 'from-amber-50 to-white border-amber-200',
  gray: 'from-gray-50 to-white border-gray-200',
}

/**
 * One prominent "what's next" card at the top of a role dashboard.
 * @param {object} props
 * @param {string} [props.eyebrow] - small label above the title, e.g. "Now"
 * @param {string} props.title
 * @param {string} [props.subtitle]
 * @param {'sky'|'green'|'amber'|'gray'} [props.tone='sky']
 * @param {{label: string, href: string}} [props.primaryAction]
 * @param {{label: string, href: string}} [props.secondaryAction]
 */
export default function HeroCard({ eyebrow, title, subtitle, tone = 'sky', primaryAction, secondaryAction }) {
  return (
    <div className={`mb-6 rounded-xl border bg-gradient-to-br p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 ${TONE[tone] || TONE.sky}`}>
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{eyebrow}</p>}
        <p className="text-lg sm:text-xl font-bold text-gray-900 mt-0.5">{title}</p>
        {subtitle && <p className="text-sm text-gray-600 mt-0.5">{subtitle}</p>}
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-wrap gap-2 shrink-0">
          {secondaryAction && (
            <Link to={secondaryAction.href} className="btn-secondary text-sm px-3 py-2">{secondaryAction.label}</Link>
          )}
          {primaryAction && (
            <Link to={primaryAction.href} className="btn-primary text-sm px-3 py-2">{primaryAction.label}</Link>
          )}
        </div>
      )}
    </div>
  )
}
