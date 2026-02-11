import { createContext, useContext, useState, useEffect } from 'react'
import api from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check for existing token on mount
    const token = localStorage.getItem('access_token')
    if (token) {
      fetchCurrentUser()
    } else {
      setLoading(false)
    }
  }, [])

  const fetchCurrentUser = async () => {
    try {
      const response = await api.get('/api/auth/me/')
      // Normalize user object to ensure school_id and school_name are available
      const userData = response.data
      if (!userData.school_id && userData.school) {
        userData.school_id = userData.school
      }
      if (!userData.school_name && userData.school_details?.name) {
        userData.school_name = userData.school_details.name
      }
      setUser(userData)
    } catch (error) {
      console.error('Failed to fetch user:', error)
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
    } finally {
      setLoading(false)
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

    // Normalize user object to ensure school_id and school_name are available
    if (!userData.school_id && userData.school) {
      userData.school_id = userData.school
    }
    if (!userData.school_name && userData.school_details?.name) {
      userData.school_name = userData.school_details.name
    }

    localStorage.setItem('access_token', access)
    localStorage.setItem('refresh_token', refresh)
    setUser(userData)

    return userData
  }

  const logout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    setUser(null)
  }

  const value = {
    user,
    loading,
    login,
    logout,
    isAuthenticated: !!user,
    isSuperAdmin: user?.is_super_admin,
    isSchoolAdmin: user?.role === 'SCHOOL_ADMIN',
    isStaffMember: user?.role === 'STAFF',
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
