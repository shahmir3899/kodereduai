/**
 * Grid wrapper for RecordCard lists — column count/gap lives here once instead
 * of being redefined per page (today every page's mobile card block picks its
 * own spacing/columns ad hoc).
 */
export default function CardGrid({ children, className = '' }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 ${className}`}>
      {children}
    </div>
  )
}
