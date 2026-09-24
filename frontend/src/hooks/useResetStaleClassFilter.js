import { useEffect } from 'react'

/**
 * Clear a class filter that isn't one of the current options.
 *
 * Section ids are per academic year: after switching year, a selected
 * 2026-27 section id (e.g. 10) is not a 2025-26 section, so pages sent it on as
 * a master class id and matched nothing while the dropdown showed "All Classes".
 * Waits for the options to load so a valid selection isn't cleared mid-fetch.
 */
export default function useResetStaleClassFilter(classFilter, setClassFilter, options, isLoading = false) {
  useEffect(() => {
    if (!classFilter || isLoading || !options?.length) return
    if (!options.some((option) => String(option.id) === String(classFilter))) {
      setClassFilter('')
    }
  }, [classFilter, setClassFilter, options, isLoading])
}
