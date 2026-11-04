import { useEffect, useState } from 'react'
import { getVideoContext } from '../utils/guideAssets'

// Phones get the portrait guide videos, everyone else the widescreen ones. No toggle: the screen decides.
// The Expo app sets its context explicitly ('app') and skips the screen check.
const QUERY = '(max-width: 767px)'

const matches = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
const current = () => getVideoContext() || (matches() ? 'mobile' : 'desktop')

export default function useVideoContext() {
  const [viewer, setViewer] = useState(current)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(QUERY)
    const onChange = () => setViewer(current())
    onChange()
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return viewer
}
