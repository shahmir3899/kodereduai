import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import api, { authApi } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState(null)
  const [activeSchool, setActiveSchool] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (token) {
      fetchCurrentUser()
    } else {
      setLoading(false)
    }
  }, [])

  const resolveActiveSchool = (userData) => {
    const schools = userData.schools || []
    const savedId = localStorage.getItem('active_school_id')

    // Try saved school first
    if (savedId) {
      const saved = schools.find(s => String(s.id) === String(savedId))
      if (saved) return saved
    }

    // Fall back to default membership
    const defaultSchool = schools.find(s => s.is_default)
    if (defaultSchool) return defaultSchool

    // Fall back to first school
    if (schools.length > 0) return schools[0]

    // Legacy fallback for users without memberships
    if (userData.school_id) {
      return {
        id: userData.school_id,
        name: userData.school_name || userData.school_details?.name || 'School',
        role: userData.role,
        is_default: true,
      }
    }

    return null
  }

  const fetchCurrentUser = async () => {
    try {
      const response = await api.get('/api/auth/me/')
      const userData = response.data
      // Normalize
      if (!userData.school_id && userData.school) {
        userData.school_id = userData.school
      }
      if (!userData.school_name && userData.school_details?.name) {
        userData.school_name = userData.school_details.name
      }
      setUser(userData)

      const school = resolveActiveSchool(userData)
      setActiveSchool(school)
      if (school) {
        localStorage.setItem('active_school_id', school.id)
      }
    } catch (error) {
      console.error('Failed to fetch user:', error)
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      localStorage.removeItem('active_school_id')
    } finally {
      setLoading(false)
    }
  }

  const refreshUser = async () => {
    try {
      const response = await api.get('/api/auth/me/')
      const userData = response.data
      if (!userData.school_id && userData.school) {
        userData.school_id = userData.school
      }
      if (!userData.school_name && userData.school_details?.name) {
        userData.school_name = userData.school_details.name
      }
      setUser(userData)
      return userData
    } catch (error) {
      console.error('Failed to refresh user:', error)
      throw error
    }
  }

  const login = async (username, password) => {
    const response = await api.post('/api/auth/login/', {
      username,
      password,
    })

    const { access, refresh, user: userData } = response.data

    if (!userData) {
      throw new Error('Login succeeded but server returned no user data.')
    }

    // Normalize
    if (!userData.school_id && userData.school) {
      userData.school_id = userData.school
    }
    if (!userData.school_name && userData.school_details?.name) {
      userData.school_name = userData.school_details.name
    }

    localStorage.setItem('access_token', access)
    localStorage.setItem('refresh_token', refresh)
    setUser(userData)

    const school = resolveActiveSchool(userData)
    setActiveSchool(school)
    if (school) {
      localStorage.setItem('active_school_id', school.id)
    }

    return userData
  }

  const logout = useCallback(() => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('active_school_id')

    // Clear academic year preferences for all schools
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('active_academic_year_')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))

    // Clear React Query cache to prevent data leakage between users
    queryClient.clear()

    setUser(null)
    setActiveSchool(null)
  }, [queryClient])

  const switchSchool = async (schoolId) => {
    try {
      const response = await authApi.switchSchool(schoolId)
      const { school_id, school_name, role } = response.data

      const newSchool = { id: school_id, name: school_name, role }
      setActiveSchool(newSchool)
      localStorage.setItem('active_school_id', school_id)

      // Reload to refresh all data for the new school context
      window.location.reload()
    } catch (error) {
      console.error('Failed to switch school:', error)
      throw error
    }
  }

  // Determine role based on active school membership
  const effectiveRole = activeSchool?.role || user?.role
  const isSchoolAdmin = user?.is_super_admin || effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'PRINCIPAL'
  const isStaffLevel = ['STAFF', 'TEACHER', 'HR_MANAGER', 'ACCOUNTANT'].includes(effectiveRole)
  const isParent = effectiveRole === 'PARENT'
  const isStudent = effectiveRole === 'STUDENT'

  // Module access: derived from the active school's enabled_modules
  const enabledModules = activeSchool?.enabled_modules || {}
  const isModuleEnabled = useCallback((moduleKey) => {
    // Super admin sees everything (they manage modules, not use them)
    if (user?.is_super_admin) return true
    return enabledModules[moduleKey] === true
  }, [user?.is_super_admin, enabledModules])

  // Role hierarchy: which roles can the current user create?
  const getAllowableRoles = useCallback(() => {
    if (user?.is_super_admin) return ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF']
    if (effectiveRole === 'SCHOOL_ADMIN') return ['PRINCIPAL', 'HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF']
    if (effectiveRole === 'PRINCIPAL') return ['HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF']
    return []
  }, [user?.is_super_admin, effectiveRole])

  const value = useMemo(() => ({
    user,
    activeSchool,
    loading,
    login,
    logout,
    switchSchool,
    refreshUser,
    isAuthenticated: !!user,
    isSuperAdmin: user?.is_super_admin,
    isSchoolAdmin,
    isPrincipal: effectiveRole === 'PRINCIPAL',
    isStaffMember: effectiveRole === 'STAFF',
    isHRManager: effectiveRole === 'HR_MANAGER',
    isTeacher: effectiveRole === 'TEACHER',
    isAccountant: effectiveRole === 'ACCOUNTANT',
    isParent,
    isStudent,
    isStaffLevel,
    effectiveRole,
    enabledModules,
    isModuleEnabled,
    getAllowableRoles,
  }), [user, activeSchool, loading, effectiveRole, enabledModules, isModuleEnabled, getAllowableRoles, login, logout, switchSchool, refreshUser, isSchoolAdmin, isParent, isStudent, isStaffLevel])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
