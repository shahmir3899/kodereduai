import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { authApi, setLogoutCallback } from '../services/api';
import {
  getAccessToken,
  setTokens,
  setActiveSchoolId,
  clearTokens,
} from '../services/auth';
import type { User, School, LoginResponse } from '../types/models';
import type { ModuleKey } from '../constants/modules';

interface AuthContextType {
  user: User | null;
  activeSchool: School | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  switchSchool: (schoolId: number) => Promise<void>;
  refreshUser: () => Promise<User>;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isSchoolAdmin: boolean;
  isPrincipal: boolean;
  isTeacher: boolean;
  isHRManager: boolean;
  isAccountant: boolean;
  isDriver: boolean;
  isParent: boolean;
  isStudent: boolean;
  isStaffLevel: boolean;
  effectiveRole: string | undefined;
  isModuleEnabled: (moduleKey: ModuleKey) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function resolveActiveSchool(userData: User, savedId?: string | null): School | null {
  const schools = userData.schools || [];

  if (savedId) {
    const saved = schools.find((s) => String(s.id) === String(savedId));
    if (saved) return saved;
  }

  const defaultSchool = schools.find((s) => s.is_default);
  if (defaultSchool) return defaultSchool;

  if (schools.length > 0) return schools[0];

  if (userData.school_id) {
    return {
      id: userData.school_id,
      name: userData.school_name || 'School',
      role: userData.role,
      is_default: true,
      enabled_modules: {},
    };
  }

  return null;
}

function normalizeUser(userData: User): User {
  if (!userData.school_id && (userData as any).school) {
    userData.school_id = (userData as any).school;
  }
  if (!userData.school_name && (userData as any).school_details?.name) {
    userData.school_name = (userData as any).school_details.name;
  }
  return userData;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [activeSchool, setActiveSchool] = useState<School | null>(null);
  const [loading, setLoading] = useState(true);

  const doLogout = useCallback(async () => {
    await clearTokens();
    setUser(null);
    setActiveSchool(null);
  }, []);

  // Register logout callback for API interceptor
  useEffect(() => {
    setLogoutCallback(() => {
      doLogout();
    });
  }, [doLogout]);

  // Check for existing session on mount
  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (token) {
        try {
          const response = await api.get('/api/auth/me/');
          const userData = normalizeUser(response.data);
          setUser(userData);
          const school = resolveActiveSchool(userData);
          setActiveSchool(school);
          if (school) {
            await setActiveSchoolId(String(school.id));
          }
        } catch {
          await clearTokens();
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (username: string, password: string): Promise<User> => {
    const response = await api.post<LoginResponse>('/api/auth/login/', {
      username,
      password,
    });

    const { access, refresh, user: userData } = response.data;

    if (!userData) {
      throw new Error('Login succeeded but server returned no user data.');
    }

    const normalized = normalizeUser(userData);
    await setTokens(access, refresh);
    setUser(normalized);

    const school = resolveActiveSchool(normalized);
    setActiveSchool(school);
    if (school) {
      await setActiveSchoolId(String(school.id));
    }

    return normalized;
  };

  const logout = doLogout;

  const switchSchool = async (schoolId: number) => {
    const response = await authApi.switchSchool(schoolId);
    const { school_id, school_name, role } = response.data;
    const newSchool: School = {
      id: school_id,
      name: school_name,
      role,
      is_default: false,
      enabled_modules: {},
    };
    setActiveSchool(newSchool);
    await setActiveSchoolId(String(school_id));
    // Refresh user to get updated enabled_modules
    await refreshUser();
  };

  const refreshUser = async (): Promise<User> => {
    const response = await api.get('/api/auth/me/');
    const userData = normalizeUser(response.data);
    setUser(userData);
    const school = resolveActiveSchool(userData);
    if (school) {
      setActiveSchool(school);
    }
    return userData;
  };

  const effectiveRole = activeSchool?.role || user?.role;
  const isSchoolAdmin =
    !!user?.is_super_admin ||
    effectiveRole === 'SCHOOL_ADMIN' ||
    effectiveRole === 'PRINCIPAL';
  const isStaffLevel = ['STAFF', 'TEACHER', 'HR_MANAGER', 'ACCOUNTANT', 'DRIVER'].includes(
    effectiveRole || ''
  );
  const isDriver = effectiveRole === 'DRIVER';
  const isParent = effectiveRole === 'PARENT';
  const isStudent = effectiveRole === 'STUDENT';

  const enabledModules = activeSchool?.enabled_modules || {};
  const isModuleEnabled = (moduleKey: ModuleKey): boolean => {
    if (user?.is_super_admin) return true;
    return enabledModules[moduleKey] === true;
  };

  const value: AuthContextType = {
    user,
    activeSchool,
    loading,
    login,
    logout,
    switchSchool,
    refreshUser,
    isAuthenticated: !!user,
    isSuperAdmin: !!user?.is_super_admin,
    isSchoolAdmin,
    isPrincipal: effectiveRole === 'PRINCIPAL',
    isTeacher: effectiveRole === 'TEACHER',
    isHRManager: effectiveRole === 'HR_MANAGER',
    isAccountant: effectiveRole === 'ACCOUNTANT',
    isDriver,
    isParent,
    isStudent,
    isStaffLevel,
    effectiveRole,
    isModuleEnabled,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
