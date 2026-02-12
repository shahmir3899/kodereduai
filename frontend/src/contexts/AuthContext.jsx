import { createContext, useContext, useState, useEffect } from 'react'
import api, { authApi } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
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

  const logout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('active_school_id')
    setUser(null)
    setActiveSchool(null)
  }

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

  const value = {
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
    isStaffLevel,
    effectiveRole,
  }

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
