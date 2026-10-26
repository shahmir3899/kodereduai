import { useEffect, useState } from 'react'

// Phones get the portrait guide videos, everyone else the widescreen ones. No toggle: the screen decides.
const QUERY = '(max-width: 767px)'

const matches = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches

export default function useMobileVideo() {
  const [mobile, setMobile] = useState(matches)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(QUERY)
    const onChange = () => setMobile(mq.matches)
    onChange()
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return mobile
}
