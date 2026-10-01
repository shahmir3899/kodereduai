import { Link } from 'react-router-dom'

/**
 * Card with a title and built-in loading / error / empty states, so a failed
 * query reads as an error instead of an empty "0".
 * @param {object} props
 * @param {string} props.title
 * @param {{label: string, href: string}} [props.action] - "View all" style link
 * @param {boolean} [props.loading]
 * @param {boolean} [props.error]
 * @param {boolean} [props.empty] - render emptyText instead of children
 * @param {string} [props.emptyText]
 * @param {string} [props.id] - in-page anchor target
 */
export default function SectionCard({ title, action, loading, error, empty, emptyText = 'Nothing to show.', id, children }) {
  let body = children
  if (loading) {
    body = (
      <div className="space-y-2 animate-pulse" aria-busy="true">
        <div className="h-4 bg-gray-100 rounded w-2/3" />
        <div className="h-4 bg-gray-100 rounded w-full" />
        <div className="h-4 bg-gray-100 rounded w-1/2" />
      </div>
    )
  } else if (error) {
    body = <p role="alert" className="text-sm text-red-600">Couldn't load this section. Try refreshing the page.</p>
  } else if (empty) {
    body = <p className="text-sm text-gray-400 text-center py-4">{emptyText}</p>
  }

  return (
    <div id={id} className="card scroll-mt-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {action && <Link to={action.href} className="text-xs text-sky-600 hover:text-sky-700 font-medium">{action.label}</Link>}
      </div>
      {body}
    </div>
  )
}
