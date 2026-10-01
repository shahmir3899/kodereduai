import { useEffect, useState } from 'react'

/** Re-renders every `intervalMs` so "Now / Next" and countdowns don't go stale on a tab left open all day. */
export default function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
