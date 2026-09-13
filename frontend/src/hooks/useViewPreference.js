import { useState, useEffect, useCallback } from 'react'
import { useMediaQuery } from './useMediaQuery'

const STORAGE_PREFIX = 'viewPref:'

/**
 * Remembers a page's Table/Cards choice (per-page, per plan discussion) and
 * forces 'cards' below the sm breakpoint regardless of the stored preference —
 * mirrors the old per-page `hidden sm:block` table / mobile-card split, just
 * driven by one hook instead of duplicated CSS+JS per page.
 *
 * @param {string} pageKey - unique per page, e.g. 'students', 'staff-directory'
 * @param {'table'|'cards'} defaultView
 */
export function useViewPreference(pageKey, defaultView = 'table') {
  const isSmallScreen = useMediaQuery('(max-width: 639px)')
  const storageKey = `${STORAGE_PREFIX}${pageKey}`

  const [storedView, setStoredView] = useState(() => {
    try {
      return localStorage.getItem(storageKey) || defaultView
    } catch {
      // localStorage can throw in private-browsing/blocked-storage contexts
      return defaultView
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, storedView)
    } catch {
      // non-fatal — preference just won't persist this session
    }
  }, [storageKey, storedView])

  const setView = useCallback((next) => {
    setStoredView(next === 'cards' ? 'cards' : 'table')
  }, [])

  return [isSmallScreen ? 'cards' : storedView, setView]
}
