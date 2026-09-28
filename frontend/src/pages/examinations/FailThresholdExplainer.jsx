// Turns the raw "fail_threshold_subjects" number into a concrete example, so an
// admin typing "2" or "4" immediately sees what that means for a real student
// rather than having to reason about the off-by-one themselves.
export default function FailThresholdExplainer({ value }) {
  const n = parseInt(value, 10)
  if (!n || n < 1) {
    return <p className="text-xs text-gray-500 mt-1">Default 3.</p>
  }

  const allowed = n - 1

  return (
    <p className="text-xs text-gray-500 mt-1">
      A student who fails <span className="font-medium text-gray-700">{n}</span> or more subjects fails the exam overall.{' '}
      {allowed > 0 ? (
        <>Failing <span className="font-medium text-gray-700">{allowed}</span> or fewer still passes overall.</>
      ) : (
        <>Every subject must be passed to pass overall.</>
      )}
    </p>
  )
}
