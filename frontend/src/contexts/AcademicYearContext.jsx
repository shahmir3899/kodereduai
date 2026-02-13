import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { sessionsApi } from '../services/api'

const AcademicYearContext = createContext(null)

export function AcademicYearProvider({ children }) {
  const { activeSchool, isAuthenticated, isSuperAdmin } = useAuth()
  const [academicYears, setAcademicYears] = useState([])
  const [activeAcademicYear, setActiveAcademicYear] = useState(null)
  const [currentTerm, setCurrentTerm] = useState(null)
  const [terms, setTerms] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchAcademicYears = useCallback(async () => {
    if (!activeSchool?.id || isSuperAdmin) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)

      // Fetch all academic years and current year in parallel
      const [yearsRes, currentRes] = await Promise.allSettled([
        sessionsApi.getAcademicYears(),
        sessionsApi.getCurrentYear(),
      ])

      const years = yearsRes.status === 'fulfilled' ? yearsRes.value.data : []
      // Handle both array and paginated responses
      const yearsList = Array.isArray(years) ? years : years.results || []
      setAcademicYears(yearsList)

      // Resolve active year: saved preference → current → first
      const savedId = localStorage.getItem(`active_academic_year_${activeSchool.id}`)
      let resolved = null

      if (savedId) {
        resolved = yearsList.find(y => String(y.id) === String(savedId))
      }

      if (!resolved && currentRes.status === 'fulfilled') {
        const currentData = currentRes.value.data
        resolved = yearsList.find(y => y.id === currentData.id) || currentData
        setTerms(currentData.terms || [])
        setCurrentTerm(currentData.current_term || null)
      }

      if (!resolved && yearsList.length > 0) {
        // Fall back to the one marked as current, or the first
        resolved = yearsList.find(y => y.is_current) || yearsList[0]
      }

      if (resolved) {
        setActiveAcademicYear(resolved)
        localStorage.setItem(`active_academic_year_${activeSchool.id}`, resolved.id)

        // If we resolved to a non-current year, fetch its terms
        if (currentRes.status !== 'fulfilled' || resolved.id !== currentRes.value?.data?.id) {
          try {
            const termsRes = await sessionsApi.getTerms({ academic_year: resolved.id })
            const termsList = Array.isArray(termsRes.data) ? termsRes.data : termsRes.data.results || []
            setTerms(termsList)
            // Find current term by date
            const today = new Date().toISOString().split('T')[0]
            const active = termsList.find(t => t.start_date <= today && t.end_date >= today)
            setCurrentTerm(active || null)
          } catch { /* terms are optional */ }
        }
      }
    } catch (error) {
      console.error('Failed to fetch academic years:', error)
    } finally {
      setLoading(false)
    }
  }, [activeSchool?.id, isSuperAdmin])

  useEffect(() => {
    if (isAuthenticated && !isSuperAdmin) {
      fetchAcademicYears()
    } else {
      setLoading(false)
    }
  }, [isAuthenticated, isSuperAdmin, fetchAcademicYears])

  const switchAcademicYear = useCallback(async (yearId) => {
    const year = academicYears.find(y => y.id === yearId)
    if (!year || year.id === activeAcademicYear?.id) return

    setActiveAcademicYear(year)
    localStorage.setItem(`active_academic_year_${activeSchool.id}`, year.id)

    // Fetch terms for the new year
    try {
      const termsRes = await sessionsApi.getTerms({ academic_year: yearId })
      const termsList = Array.isArray(termsRes.data) ? termsRes.data : termsRes.data.results || []
      setTerms(termsList)
      const today = new Date().toISOString().split('T')[0]
      const active = termsList.find(t => t.start_date <= today && t.end_date >= today)
      setCurrentTerm(active || null)
    } catch {
      setTerms([])
      setCurrentTerm(null)
    }
  }, [academicYears, activeAcademicYear?.id, activeSchool?.id])

  const refresh = useCallback(() => {
    return fetchAcademicYears()
  }, [fetchAcademicYears])

  const value = {
    academicYears,
    activeAcademicYear,
    currentTerm,
    terms,
    loading,
    switchAcademicYear,
    refresh,
    hasAcademicYear: !!activeAcademicYear,
  }

  return (
    <AcademicYearContext.Provider value={value}>
      {children}
    </AcademicYearContext.Provider>
  )
}

export function useAcademicYear() {
  const context = useContext(AcademicYearContext)
  if (!context) {
    throw new Error('useAcademicYear must be used within an AcademicYearProvider')
  }
  return context
}
