import Spinner from './ui/Spinner'

// Full-viewport loading state (e.g. route-level suspense fallback).
// Thin wrapper kept for existing call sites — see ui/Spinner.jsx for the
// underlying primitive and its inline/sized variants.
export default function LoadingSpinner() {
  return <Spinner fullScreen size="lg" />
}
