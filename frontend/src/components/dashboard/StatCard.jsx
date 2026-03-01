import { Link } from 'react-router-dom'

const COLOR_MAP = {
  sky:    { bg: 'bg-sky-50',    text: 'text-sky-700',    icon: 'bg-sky-100 text-sky-600' },
  green:  { bg: 'bg-green-50',  text: 'text-green-700',  icon: 'bg-green-100 text-green-600' },
  red:    { bg: 'bg-red-50',    text: 'text-red-700',    icon: 'bg-red-100 text-red-600' },
  amber:  { bg: 'bg-amber-50',  text: 'text-amber-700',  icon: 'bg-amber-100 text-amber-600' },
  blue:   { bg: 'bg-blue-50',   text: 'text-blue-700',   icon: 'bg-blue-100 text-blue-600' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-700', icon: 'bg-purple-100 text-purple-600' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', icon: 'bg-orange-100 text-orange-600' },
  gray:   { bg: 'bg-gray-50',   text: 'text-gray-700',   icon: 'bg-gray-100 text-gray-600' },
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="h-3.5 bg-gray-200 rounded w-20 mb-2.5" />
          <div className="h-7 bg-gray-100 rounded w-16 mb-1.5" />
          <div className="h-3 bg-gray-100 rounded w-24" />
        </div>
        <div className="w-10 h-10 bg-gray-100 rounded-lg" />
      </div>
    </div>
  )
}

/**
 * @param {object} props
 * @param {string} props.label - Card title
 * @param {string|number} props.value - Primary metric
 * @param {string} [props.subtitle] - Secondary text below value
 * @param {React.ReactNode} [props.icon] - SVG icon element
 * @param {'sky'|'green'|'red'|'amber'|'blue'|'purple'|'orange'|'gray'} [props.color='sky']
 * @param {string} [props.href] - Link destination
 * @param {boolean} [props.loading]
 */
export default function StatCard({ label, value, subtitle, icon, color = 'sky', href, loading }) {
  if (loading) return <SkeletonCard />

  const c = COLOR_MAP[color] || COLOR_MAP.sky

  const content = (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 transition-shadow ${href ? 'hover:shadow-md cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {subtitle && <p className={`text-xs mt-0.5 ${c.text}`}>{subtitle}</p>}
        </div>
        {icon && (
          <div className={`w-10 h-10 rounded-lg ${c.icon} flex items-center justify-center shrink-0`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )

  if (href) {
    return <Link to={href} className="block">{content}</Link>
  }

  return content
}
