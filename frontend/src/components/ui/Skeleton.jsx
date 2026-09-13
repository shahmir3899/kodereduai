/**
 * Shared skeleton loading primitive. Replaces a blanking <Spinner/> for
 * table/list regions so the page shell (headers, filters) renders immediately
 * and the content area fills in without the whole region flashing empty —
 * reduces the layout jump users hit when a spinner disappears and a full
 * table pops in at once.
 *
 * Usage:
 *   <Skeleton className="h-4 w-32" />                 // a single bar
 *   <SkeletonTable rows={5} cols={4} />                // table body placeholder;
 *                                                       // render your real <thead> above it
 */

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-gray-100">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className="h-4 w-full max-w-[10rem]" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

export default Skeleton
