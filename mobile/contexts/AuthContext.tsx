import { setSchoolTimeZone } from '../services/schoolTime';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { authApi, setLogoutCallback } from '../services/api';
import {
  getAccessToken,
  getActiveSchoolId,
  setTokens,
  setActiveSchoolId,
  clearTokens,
} from '../services/auth';
import type { User, School, LoginResponse } from '../types/models';
import type { ModuleKey } from '../constants/modules';
import { clearQueryCache } from '../services/queryClient';
import { performSchoolSwitch } from '../services/schoolSwitch';
import { refreshEndsSession } from '../services/sessionRules';
import { unregisterCurrentPushToken } from '../services/notifications';
import { personaFor, type Persona } from '../navigation/personas';

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
  isManager: boolean;
  isAccountant: boolean;
  isDriver: boolean;
  isParent: boolean;
  isStudent: boolean;
  isStaffLevel: boolean;
  isStaff: boolean;
  isSchoolAdminNav: boolean;
  persona: Persona;
  schoolEpoch: number;
  // True after the server ended the session, so the login screen can say why.
  sessionExpired: boolean;
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
  const [schoolEpoch, setSchoolEpoch] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);

  const doLogout = useCallback(async (expired = false) => {
    // An expired session has no valid login left, so the unregister call could not authenticate.
    if (!expired) await unregisterCurrentPushToken();
    await clearTokens();
    // The next sign-in on this phone must not see this user's cached data.
    await clearQueryCache();
    setSessionExpired(expired);
    setUser(null);
    setActiveSchool(null);
  }, []);

  // Register logout callback for API interceptor
  useEffect(() => {
    setLogoutCallback(() => {
      doLogout(true);
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
          // Without the saved id a multi-school user always came back as their default school.
          const school = resolveActiveSchool(userData, await getActiveSchoolId());
          setActiveSchool(school);
          if (school) {
            await setActiveSchoolId(String(school.id));
          }
        } catch (error) {
          // Starting the app offline must not throw away a valid session.
          if (refreshEndsSession(error as any)) await clearTokens();
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
    setSessionExpired(false);
    setUser(normalized);

    const school = resolveActiveSchool(normalized);
    setActiveSchool(school);
    if (school) {
      await setActiveSchoolId(String(school.id));
    }

    return normalized;
  };

  // Wrapped so a press handler's event argument is never read as the `expired` flag.
  const logout = () => doLogout(false);

  const switchSchool = async (schoolId: number) => {
    await performSchoolSwitch(schoolId, {
      checkAccess: authApi.switchSchool,
      getSavedSchoolId: getActiveSchoolId,
      saveSchoolId: setActiveSchoolId,
      refreshUser,
    });
    await clearQueryCache();
    // The root layout keys its navigator on this, so screens still mounted from the previous
    // school (same role, so no redirect) remount and refetch instead of showing stale data.
    setSchoolEpoch((n) => n + 1);
  };

  const refreshUser = async (): Promise<User> => {
    const response = await api.get('/api/auth/me/');
    const userData = normalizeUser(response.data);
    setUser(userData);
    // switchSchool stores the new id before calling this; honouring it keeps the user on the
    // school they just picked instead of snapping back to their default.
    const school = resolveActiveSchool(userData, await getActiveSchoolId());
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
  const isStaffLevel = ['STAFF', 'TEACHER', 'MANAGER', 'ACCOUNTANT', 'DRIVER'].includes(
    effectiveRole || ''
  );
  const isStaff = effectiveRole === 'STAFF';
  const isDriver = effectiveRole === 'DRIVER';
  const persona = personaFor(effectiveRole, !!user?.is_super_admin);
  const isParent = effectiveRole === 'PARENT';
  const isStudent = effectiveRole === 'STUDENT';

  // Set while rendering, not in an effect: screens that mount right after login read "today" on first render.
  setSchoolTimeZone(activeSchool?.timezone);

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
    isManager: effectiveRole === 'MANAGER',
    isAccountant: effectiveRole === 'ACCOUNTANT',
    isDriver,
    isParent,
    isStudent,
    isStaffLevel,
    isStaff,
    isSchoolAdminNav: persona === 'admin',
    persona,
    schoolEpoch,
    sessionExpired,
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
