import { Link } from 'react-router-dom'

const STATUS_DOT = {
  green:  'bg-green-500',
  yellow: 'bg-amber-400',
  red:    'bg-red-500',
  gray:   'bg-gray-300',
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3.5 animate-pulse">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 bg-gray-100 rounded-lg" />
        <div className="flex-1">
          <div className="h-3.5 bg-gray-200 rounded w-16 mb-1.5" />
          <div className="h-3 bg-gray-100 rounded w-12" />
        </div>
        <div className="w-2 h-2 bg-gray-200 rounded-full" />
      </div>
    </div>
  )
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.icon
 * @param {string} props.label - Module name
 * @param {string|number} props.metric - Primary value to display
 * @param {string} [props.metricLabel] - Text after metric (e.g., "rate")
 * @param {'green'|'yellow'|'red'|'gray'} [props.status='gray']
 * @param {string} [props.href] - Link destination
 * @param {boolean} [props.loading]
 */
export default function ModuleHealthCard({ icon, label, metric, metricLabel, status = 'gray', href, loading }) {
  if (loading) return <SkeletonCard />

  const content = (
    <div className="bg-white rounded-xl border border-gray-200 p-3.5 hover:shadow-sm hover:border-gray-300 transition-all cursor-pointer">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 text-gray-500">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 truncate">{label}</p>
          <p className="text-sm font-semibold text-gray-900">
            {metric}
            {metricLabel && <span className="text-xs font-normal text-gray-500 ml-0.5">{metricLabel}</span>}
          </p>
        </div>
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[status] || STATUS_DOT.gray}`} />
      </div>
    </div>
  )

  if (href) {
    return <Link to={href} className="block">{content}</Link>
  }

  return content
}
