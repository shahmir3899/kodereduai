import { Link } from 'react-router-dom'
import FeeCategoryBreakdown from './FeeCategoryBreakdown'

/**
 * Current-month MONTHLY fee collection block. Shared by the admin and finance
 * dashboards so the layout and the per-school breakdown cannot drift apart.
 * Renders content only; the caller supplies the surrounding card/section.
 */
export default function MonthlyFeeCollectionCard({ fee, detailsHref = '/finance/fees', monthLabel }) {
  if (!fee) return null
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Monthly fees {monthLabel ? `— ${monthLabel}` : 'this month'}{fee.isMulti ? ' · all schools' : ''}
        </p>
        <Link to={detailsHref} className="text-xs text-sky-600 hover:text-sky-700 font-medium">View details</Link>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center p-3 bg-green-50 rounded-lg">
          <p className="text-xs text-green-600 mb-0.5">Collected</p>
          <p className="text-sm sm:text-base font-bold text-green-700">Rs. {fee.totalCollected.toLocaleString()}</p>
        </div>
        <div className="text-center p-3 bg-orange-50 rounded-lg">
          <p className="text-xs text-orange-600 mb-0.5">Pending</p>
          <p className="text-sm sm:text-base font-bold text-orange-700">Rs. {fee.totalPending.toLocaleString()}</p>
        </div>
        <div className="text-center p-3 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-600 mb-0.5">Paid / Partial / Unpaid</p>
          <p className="text-sm sm:text-base font-bold text-gray-700 tabular-nums">
            {fee.paidCount} / {fee.partialCount} / {fee.unpaidCount}
          </p>
        </div>
      </div>
      <FeeCategoryBreakdown summary={fee} />
    </div>
  )
}
