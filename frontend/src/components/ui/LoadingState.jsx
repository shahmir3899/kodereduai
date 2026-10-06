import Spinner from './Spinner'

/**
 * In-page loading state: a centered spinner with a label. Replaces the bare
 * "Loading..." text blocks that pages hand-rolled (each with different padding
 * and colour). For table bodies prefer <SkeletonTable/> so the layout doesn't jump.
 *
 * Don't use <Spinner fullScreen/> inside a card — it forces min-h-screen.
 *
 * Usage:
 *   <LoadingState />                              // "Loading..."
 *   <LoadingState label="Loading calendar..." />
 *   <LoadingState size="sm" compact />            // tight, for modals/side panels
 */
export default function LoadingState({ label = 'Loading...', size = 'md', compact = false, className = '' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-2 text-center ${compact ? 'py-4' : 'py-10'} ${className}`}
    >
      <Spinner size={size} />
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  )
}
