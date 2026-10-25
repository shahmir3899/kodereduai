/** A slim "where am I" bar for the top of the guide: setup steps done and videos watched. */
export default function ProgressSummary({ stepsDone, stepsTotal, videosWatched, videosTotal }) {
  if (!stepsTotal && !videosTotal) return null
  const useSteps = stepsTotal >= 2
  const done = useSteps ? stepsDone : videosWatched
  const total = useSteps ? stepsTotal : videosTotal
  const percent = total ? Math.round((done / total) * 100) : 0
  const finished = total > 0 && done >= total

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5">
      <span className="text-sm font-semibold text-gray-900">Your progress</span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={useSteps ? 'Start here steps completed' : 'Videos watched'}
        className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-gray-200"
      >
        <div className={`h-full rounded-full transition-all ${finished ? 'bg-green-500' : 'bg-primary-500'}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-gray-600">
        {useSteps && <><strong className="text-gray-900">{stepsDone} of {stepsTotal}</strong> start steps</>}
        {useSteps && videosTotal > 0 && <span aria-hidden="true"> &middot; </span>}
        {videosTotal > 0 && <><strong className="text-gray-900">{videosWatched} of {videosTotal}</strong> videos watched</>}
      </span>
      {finished && <span className="text-xs font-semibold text-green-700">All done</span>}
    </div>
  )
}
