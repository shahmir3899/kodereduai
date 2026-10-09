import { TONE } from '../ui/statusTones'

const fmt = (n) => Number(n || 0).toLocaleString()
const rateTone = (rate) => (rate == null ? TONE.neutral : rate >= 80 ? TONE.success : rate >= 50 ? TONE.warning : TONE.danger)

function RateBadge({ rate }) {
  return (
    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${rateTone(rate)}`}>
      {rate == null ? '—' : `${rate}%`}
    </span>
  )
}

/**
 * Monthly fee categories (shown only when the school has more than one; the
 * headline total is their accumulated rate) and, for multi-school admins, a
 * per-school list. Shared by the admin and finance dashboards so the breakdown
 * cannot diverge between them.
 */
export default function FeeCategoryBreakdown({ summary, alwaysShowCategories = false }) {
  if (!summary) return null
  const showCategories = summary.byCategory.length > (alwaysShowCategories ? 0 : 1)
  const showSchools = summary.isMulti && summary.schools.length > 0
  if (!showCategories && !showSchools) return null

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
      {showCategories && (
        <div className="space-y-1.5">
          {summary.byCategory.map((cat) => (
            <div key={cat.id || cat.name} className="flex items-center justify-between text-xs gap-2">
              <span className="text-gray-700">{cat.name}</span>
              <span className="flex items-center gap-2 text-gray-800">
                {fmt(cat.totalCollected)} / {fmt(cat.totalDue)}
                <RateBadge rate={cat.rate} />
              </span>
            </div>
          ))}
        </div>
      )}

      {showSchools && (
        <div className="space-y-1.5">
          {summary.schools.map((school) => (
            <div key={school.schoolId} className="border rounded-lg p-2">
              <p className="text-xs font-medium text-gray-600 mb-1">{school.schoolName}</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-green-700">{fmt(school.totalCollected)}</span>
                <span className="text-gray-400">/</span>
                <span className="text-gray-600">{fmt(school.totalDue)}</span>
                <span className="text-orange-700 text-xs">Pending {fmt(school.totalPending)}</span>
                <RateBadge rate={school.rate} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
