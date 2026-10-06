import Button from './Button'

/**
 * Shared "request failed" block for a failed query. Without it, pages render
 * nothing (or an empty list) when the API errors, which reads as "no data".
 *
 * Usage:
 *   if (isError) return <ErrorState onRetry={refetch} />
 *   <ErrorState message="Could not load fee data." onRetry={refetch} compact />
 */
export default function ErrorState({ title = 'Something went wrong', message = 'We could not load this. Please try again.', onRetry, compact = false, className = '' }) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-12'} ${className}`}>
      <p className="text-sm font-medium text-red-700 dark:text-red-400">{title}</p>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-sm">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
