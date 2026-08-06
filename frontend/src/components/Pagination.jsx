/**
 * Reusable Previous/Next pagination control for DRF-paginated list endpoints.
 *
 * Usage:
 *   <Pagination page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />
 */
export default function Pagination({ page, totalPages, totalCount, onPageChange, itemLabel = 'total' }) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-sm text-gray-500">
        Page {page} of {totalPages} ({totalCount} {itemLabel})
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  )
}
