import { Link } from 'react-router-dom'

/**
 * @param {object} props
 * @param {Array<{label: string, description?: string, href: string, icon: React.ReactNode, color?: string, badge?: number}>} props.actions
 */
export default function QuickActionGrid({ actions }) {
  if (!actions?.length) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      {actions.map((action) => (
        <Link
          key={action.href + action.label}
          to={action.href}
          className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all text-center group ${action.color || 'bg-white'}`}
        >
          <div className="w-9 h-9 rounded-lg bg-gray-50 group-hover:bg-gray-100 flex items-center justify-center transition-colors">
            {action.icon}
          </div>
          <span className="text-xs font-medium text-gray-700 leading-tight">{action.label}</span>
          {action.badge > 0 && (
            <span className="absolute top-1.5 right-1.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {action.badge > 99 ? '99+' : action.badge}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}
