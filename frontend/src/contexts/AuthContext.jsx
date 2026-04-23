import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import api, {
  authApi,
  academicsApi,
  admissionsApi,
  attendanceApi,
  bootstrapApi,
  classesApi,
  examinationsApi,
  financeApi,
  hostelApi,
  hrApi,
  inventoryApi,
  libraryApi,
  lmsApi,
  membershipsApi,
  notificationsApi,
  organizationsApi,
  parentsApi,
  schoolsApi,
  sessionsApi,
  studentPortalApi,
  tasksApi,
  transportApi,
  usersApi,
} from '../services/api'
import {
  clearAuthState,
  getAccessToken,
  getActiveSchoolId,
  setActiveSchoolId,
  setAuthTokens,
} from '../services/authStorage'

const AuthContext = createContext(null)

const PRELOAD_ENABLED = String(import.meta.env.VITE_LOGIN_PRELOAD_ENABLED || 'false').toLowerCase() === 'true'
const PRELOAD_DEBUG = String(import.meta.env.VITE_LOGIN_PRELOAD_DEBUG || 'false').toLowerCase() === 'true'
const PRELOAD_TIMEOUT_MS = Number(import.meta.env.VITE_LOGIN_PRELOAD_TIMEOUT_MS || 6000)
const PRELOAD_MAX_CONCURRENCY = Math.max(1, Number(import.meta.env.VITE_LOGIN_PRELOAD_MAX_CONCURRENCY || 3))
const PRELOAD_TIER_B_ENABLED = String(import.meta.env.VITE_LOGIN_PRELOAD_TIER_B_ENABLED || 'true').toLowerCase() === 'true'
const PRELOAD_TIER_B_DELAY_MS = Math.max(0, Number(import.meta.env.VITE_LOGIN_PRELOAD_TIER_B_DELAY_MS || 1200))
const PRELOAD_TELEMETRY_ENABLED = String(import.meta.env.VITE_LOGIN_PRELOAD_TELEMETRY_ENABLED || 'true').toLowerCase() === 'true'
const PRELOAD_TELEMETRY_MAX_EVENTS = Math.max(1, Number(import.meta.env.VITE_LOGIN_PRELOAD_TELEMETRY_MAX_EVENTS || 25))

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('preload_timeout')), timeoutMs)
    }),
  ])
}

function getTodayContext() {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const dayName = DAY_NAMES[now.getDay()]
  const monthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`
  return { now, today, currentMonth, currentYear, dayName, monthStart }
}

function isModuleAvailable({ moduleKey, enabledModules, isSuperAdmin }) {
  if (isSuperAdmin) return true
  const moduleConfig = enabledModules?.[moduleKey]
  if (typeof moduleConfig === 'boolean') return moduleConfig
  if (moduleConfig && typeof moduleConfig === 'object') return !!moduleConfig.enabled
  return false
}

function normalizeListResponse(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  return []
}

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function savePreloadTelemetry(sample) {
  if (!PRELOAD_TELEMETRY_ENABLED || typeof window === 'undefined') return
  try {
    const key = 'login_preload_telemetry_v1'
    const existing = window.localStorage.getItem(key)
    const parsed = existing ? JSON.parse(existing) : []
    const list = Array.isArray(parsed) ? parsed : []
    list.push(sample)
    const trimmed = list.slice(-PRELOAD_TELEMETRY_MAX_EVENTS)
    window.localStorage.setItem(key, JSON.stringify(trimmed))
  } catch {
    // Telemetry should never impact auth or preload behavior.
  }
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState(null)
  const [activeSchool, setActiveSchool] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isSwitchingSchool, setIsSwitchingSchool] = useState(false)
  const lastPreloadFingerprintRef = useRef('')

  useEffect(() => {
    const token = getAccessToken()
    if (token) {
      fetchCurrentUser()
    } else {
      setLoading(false)
    }
  }, [])

  const resolveActiveSchool = (userData) => {
    const schools = userData.schools || []
    const savedId = getActiveSchoolId()

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
        setActiveSchoolId(String(school.id))
      }

      void preloadVisibleData(userData, school)
    } catch (error) {
      console.error('Failed to fetch user:', error)
      clearAuthState()
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

  const login = async (username, password, rememberMe = false) => {
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

    setAuthTokens(access, refresh, rememberMe)
    setUser(userData)

    const school = resolveActiveSchool(userData)
    setActiveSchool(school)
    if (school) {
      setActiveSchoolId(String(school.id))
    }

    void preloadVisibleData(userData, school)

    return userData
  }

  const preloadVisibleData = useCallback(async (userData, school) => {
    if (!PRELOAD_ENABLED || !userData || !school) return

    const isSuperAdmin = !!userData.is_super_admin
    const effectiveRole = school?.role || userData?.role
    const enabledModules = school?.enabled_modules || {}

    const fingerprint = `${userData.id}:${school.id}:${effectiveRole}`
    if (lastPreloadFingerprintRef.current === fingerprint) return
    lastPreloadFingerprintRef.current = fingerprint

    let activeAcademicYearId = null
    if (!isSuperAdmin && effectiveRole !== 'PARENT' && effectiveRole !== 'STUDENT') {
      try {
        const yearsRes = await withTimeout(
          queryClient.fetchQuery({
            queryKey: ['academicYears'],
            queryFn: () => sessionsApi.getAcademicYears(),
            staleTime: 5 * 60 * 1000,
          }),
          PRELOAD_TIMEOUT_MS,
        )
        const years = normalizeListResponse(yearsRes?.data)
        const savedId = window.localStorage.getItem(`active_academic_year_${school.id}`)
        const resolved = (savedId && years.find(y => String(y.id) === String(savedId))) || years.find(y => y.is_current) || years[0] || null
        activeAcademicYearId = resolved?.id || null
      } catch {
        activeAcademicYearId = null
      }
    }

    const { today, currentMonth, currentYear, dayName, monthStart } = getTodayContext()
    const tierATasks = []
    const tierBTasks = []
    const preloadStartMs = nowMs()
    const telemetry = {
      timestamp: new Date().toISOString(),
      role: effectiveRole,
      schoolId: school.id,
      tierA: {
        planned: 0,
        success: 0,
        failed: 0,
        timeouts: 0,
        durationMs: 0,
      },
      tierB: {
        planned: 0,
        success: 0,
        failed: 0,
        timeouts: 0,
        durationMs: 0,
        scheduled: false,
      },
      tierAScheduleMs: 0,
    }

    const addPrefetch = (queryKey, queryFn, staleTime = 2 * 60 * 1000, tier = 'A') => {
      const queue = tier === 'B' ? tierBTasks : tierATasks
      const bucket = tier === 'B' ? telemetry.tierB : telemetry.tierA
      bucket.planned += 1
      queue.push(async () => {
        try {
          await withTimeout(
            queryClient.prefetchQuery({ queryKey, queryFn, staleTime }),
            PRELOAD_TIMEOUT_MS,
          )
          bucket.success += 1
        } catch (error) {
          bucket.failed += 1
          if ((error?.message || '') === 'preload_timeout') {
            bucket.timeouts += 1
          }
          if (PRELOAD_DEBUG) {
            console.warn('[preload] failed', queryKey, error?.message || error)
          }
        }
      })
    }

    const runQueue = async (queue, tier = 'A') => {
      const runStart = nowMs()
      const workerCount = Math.min(PRELOAD_MAX_CONCURRENCY, queue.length)
      const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length) {
          const task = queue.shift()
          if (task) {
            await task()
          }
        }
      })
      await Promise.all(workers)
      const runDuration = Math.max(0, Math.round(nowMs() - runStart))
      if (tier === 'B') {
        telemetry.tierB.durationMs = runDuration
      } else {
        telemetry.tierA.durationMs = runDuration
      }
    }

    const scheduleTierB = (queue) => {
      if (!queue.length || !PRELOAD_TIER_B_ENABLED) return
      telemetry.tierB.scheduled = true
      const runDeferred = () => {
        void runQueue(queue, 'B').then(() => {
          savePreloadTelemetry({
            ...telemetry,
            totalDurationMs: Math.max(0, Math.round(nowMs() - preloadStartMs)),
          })
        })
      }

      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(runDeferred, { timeout: PRELOAD_TIER_B_DELAY_MS + PRELOAD_TIMEOUT_MS })
        return
      }

      setTimeout(runDeferred, PRELOAD_TIER_B_DELAY_MS)
    }

    addPrefetch(['dashboardNotifications', 5], () => notificationsApi.getMyNotifications({ limit: 5 }))
    addPrefetch(['unreadCount'], () => notificationsApi.getUnreadCount())

    // Prime class filter datasets used across ClassSelector/useSessionClasses hooks.
    if (!isSuperAdmin && effectiveRole !== 'PARENT' && effectiveRole !== 'STUDENT') {
      addPrefetch(
        ['classes', school.id],
        () => classesApi.getClasses({ school_id: school.id, page_size: 9999 }),
        5 * 60 * 1000,
      )
      if (activeAcademicYearId) {
        addPrefetch(
          ['session-classes', school.id, activeAcademicYearId],
          () => sessionsApi.getSessionClasses({
            school_id: school.id,
            academic_year: activeAcademicYearId,
            page_size: 9999,
            is_active: true,
          }),
          5 * 60 * 1000,
        )
      }
    }

    if (isSuperAdmin) {
      addPrefetch(['platformStats'], () => schoolsApi.getPlatformStats(), 2 * 60 * 1000, 'A')
      addPrefetch(['adminSchools'], () => schoolsApi.getAllSchools({ page_size: 9999 }), 2 * 60 * 1000, 'A')
      addPrefetch(['moduleRegistry'], () => schoolsApi.getModuleRegistry(), 5 * 60 * 1000, 'B')
      addPrefetch(['adminUsers'], () => usersApi.getUsers({ page_size: 100 }), 2 * 60 * 1000, 'B')
      addPrefetch(['adminOrgs'], () => organizationsApi.getAll({ page_size: 9999 }), 2 * 60 * 1000, 'B')
      addPrefetch(['adminMemberships'], () => membershipsApi.getAll({ page_size: 9999 }), 2 * 60 * 1000, 'B')
    } else if (effectiveRole === 'PARENT') {
      addPrefetch(['myChildren'], () => parentsApi.getMyChildren())
      tierBTasks.push(async () => {
        try {
          const childrenRes = await withTimeout(
            queryClient.fetchQuery({
              queryKey: ['myChildren'],
              queryFn: () => parentsApi.getMyChildren(),
              staleTime: 2 * 60 * 1000,
            }),
            PRELOAD_TIMEOUT_MS,
          )
          const children = normalizeListResponse(childrenRes?.data)
          const topChildren = children.slice(0, 3)
          await Promise.all(topChildren.map(async (child) => {
            const childClassId = child.class_id || child.class_obj || child.class_obj_id || null
            const subtasks = [
              queryClient.prefetchQuery({
                queryKey: ['childOverview', child.id],
                queryFn: () => parentsApi.getChildOverview(child.id),
                staleTime: 5 * 60 * 1000,
              }),
            ]
            if (childClassId) {
              subtasks.push(
                queryClient.prefetchQuery({
                  queryKey: ['childTodayDayStatus', child.id, today, childClassId],
                  queryFn: () => sessionsApi.getCalendarDayStatus({
                    date_from: today,
                    date_to: today,
                    class_id: childClassId,
                  }),
                  staleTime: 5 * 60 * 1000,
                }),
              )
            }
            await Promise.allSettled(subtasks)
          }))
        } catch (error) {
          if (PRELOAD_DEBUG) {
            console.warn('[preload] parent child chain failed', error?.message || error)
          }
        }
      })
    } else if (effectiveRole === 'STUDENT') {
      addPrefetch(['studentDashboard'], () => studentPortalApi.getDashboard())
      addPrefetch(['studentExamResults'], () => studentPortalApi.getExamResults({ page_size: 5 }))
      tierBTasks.push(async () => {
        try {
          const dashboardRes = await withTimeout(
            queryClient.fetchQuery({
              queryKey: ['studentDashboard'],
              queryFn: () => studentPortalApi.getDashboard(),
              staleTime: 2 * 60 * 1000,
            }),
            PRELOAD_TIMEOUT_MS,
          )
          const student = dashboardRes?.data?.student || {}
          const studentClassId = student.class_id || student.class_obj || student.class_obj_id || null
          if (!studentClassId) return
          await withTimeout(
            queryClient.prefetchQuery({
              queryKey: ['studentDashboardDayStatus', today, studentClassId],
              queryFn: () => sessionsApi.getCalendarDayStatus({
                date_from: today,
                date_to: today,
                class_id: studentClassId,
              }),
            }),
            PRELOAD_TIMEOUT_MS,
          )
        } catch (error) {
          if (PRELOAD_DEBUG) {
            console.warn('[preload] student day-status chain failed', error?.message || error)
          }
        }
      })
    } else if (effectiveRole === 'TEACHER') {
      addPrefetch(
        ['myTimetable', dayName, activeAcademicYearId],
        () => academicsApi.getMyTimetable({ day: dayName, ...(activeAcademicYearId && { academic_year: activeAcademicYearId }) }),
        2 * 60 * 1000,
        'A',
      )
      addPrefetch(['myClassTeacherAssignments', activeAcademicYearId], () => academicsApi.getMyClassTeacherAssignments(), 5 * 60 * 1000, 'A')
      if (isModuleAvailable({ moduleKey: 'attendance', enabledModules, isSuperAdmin })) {
        addPrefetch(['myAttendanceClasses'], () => attendanceApi.getMyAttendanceClasses(), 2 * 60 * 1000, 'B')
      }
      if (isModuleAvailable({ moduleKey: 'academics', enabledModules, isSuperAdmin })) {
        addPrefetch(
          ['mySubjectAssignments', activeAcademicYearId],
          () => academicsApi.getMySubjectAssignments(activeAcademicYearId ? { academic_year: activeAcademicYearId } : undefined),
          5 * 60 * 1000,
          'A',
        )
        addPrefetch(['pendingSubmissions'], () => lmsApi.getSubmissions({ status: 'SUBMITTED', page_size: 10 }), 2 * 60 * 1000, 'B')
      }
      if (isModuleAvailable({ moduleKey: 'examinations', enabledModules, isSuperAdmin })) {
        addPrefetch(
          ['teacherExams', activeAcademicYearId],
          () => examinationsApi.getExams({ ...(activeAcademicYearId && { academic_year: activeAcademicYearId }), page_size: 10 }),
          2 * 60 * 1000,
          'B',
        )
      }
      // Preload full-month attendance for all teacher-visible classes in one request
      if (isModuleAvailable({ moduleKey: 'attendance', enabledModules, isSuperAdmin }) && activeAcademicYearId) {
        tierBTasks.push(async () => {
          try {
            const [yy, mm] = today.split('-').map(Number)
            const daysInMonth = new Date(yy, mm, 0).getDate()
            const dateFrom = `${yy}-${String(mm).padStart(2, '0')}-01`
            const dateTo = `${yy}-${String(mm).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
            const res = await withTimeout(
              attendanceApi.getMonthlyBulk({ month: mm, year: yy, academic_year: activeAcademicYearId }),
              PRELOAD_TIMEOUT_MS * 2,
            )
            const byClass = res?.data?.by_class || {}
            for (const [scId, records] of Object.entries(byClass)) {
              queryClient.setQueryData(
                ['attendanceRecords', dateFrom, dateTo, scId, activeAcademicYearId],
                { data: { results: records } },
              )
            }
          } catch (err) {
            if (PRELOAD_DEBUG) console.warn('[preload] monthly_bulk (teacher) failed', err?.message)
          }
        })
      }
    } else if (effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'PRINCIPAL') {
      // Bootstrap call: attendance + hr + finance in one round trip.
      // Individual React Query cache entries are populated from the combined response,
      // so dashboard pages hit the cache instantly when they mount.
      addPrefetch(
        ['adminDashboardBootstrap', today, school.id, activeAcademicYearId, currentMonth, currentYear],
        async () => {
          const res = await bootstrapApi.getAdminDashboard({
            date: today,
            ...(activeAcademicYearId && { academic_year: activeAcademicYearId }),
            month: currentMonth,
            year: currentYear,
          })
          const data = res.data || {}
          if (data.attendance != null) {
            queryClient.setQueryData(
              ['dailyReport', today, school.id, activeAcademicYearId],
              { data: data.attendance },
            )
          }
          if (data.hr != null) {
            queryClient.setQueryData(['hrDashboardStats'], { data: data.hr })
          }
          if (data.finance != null) {
            queryClient.setQueryData(
              ['financeSummaryDashboard', currentMonth, currentYear, activeAcademicYearId],
              { data: data.finance },
            )
          }
          return res
        },
        2 * 60 * 1000,
        'A',
      )
      // Pending review uploads — separate call (full list needed for the review queue UI)
      if (isModuleAvailable({ moduleKey: 'attendance', enabledModules, isSuperAdmin })) {
        addPrefetch(
          ['pendingReviews', activeAcademicYearId],
          () => attendanceApi.getPendingReviews({ ...(activeAcademicYearId && { academic_year: activeAcademicYearId }) }),
          2 * 60 * 1000,
          'A',
        )
      }
      if (isModuleAvailable({ moduleKey: 'admissions', enabledModules, isSuperAdmin })) {
        addPrefetch(['admissionsNewCount'], () => admissionsApi.getEnquiries({ status: 'NEW', page_size: 1 }), 2 * 60 * 1000, 'B')
      }
      if (isModuleAvailable({ moduleKey: 'examinations', enabledModules, isSuperAdmin })) {
        addPrefetch(
          ['upcomingExams', activeAcademicYearId],
          () => examinationsApi.getExams({ status: 'SCHEDULED', page_size: 1, academic_year: activeAcademicYearId || undefined }),
          2 * 60 * 1000,
          'B',
        )
      }
      if (isModuleAvailable({ moduleKey: 'transport', enabledModules, isSuperAdmin })) {
        addPrefetch(['transportDashboard'], () => transportApi.getDashboardStats(), 2 * 60 * 1000, 'B')
      }
      if (isModuleAvailable({ moduleKey: 'library', enabledModules, isSuperAdmin })) {
        addPrefetch(['libraryStats'], () => libraryApi.getStats(), 2 * 60 * 1000, 'B')
      }
      if (isModuleAvailable({ moduleKey: 'hostel', enabledModules, isSuperAdmin })) {
        addPrefetch(['hostelDashboard'], () => hostelApi.getDashboard(), 2 * 60 * 1000, 'B')
      }
      if (isModuleAvailable({ moduleKey: 'inventory', enabledModules, isSuperAdmin })) {
        addPrefetch(['inventoryDashboard'], () => inventoryApi.getDashboard(), 2 * 60 * 1000, 'B')
      }
      addPrefetch(['aiInsights'], () => tasksApi.getAIInsights(), 5 * 60 * 1000, 'B')
      // Preload full-month attendance for all classes in one request
      if (isModuleAvailable({ moduleKey: 'attendance', enabledModules, isSuperAdmin }) && activeAcademicYearId) {
        tierBTasks.push(async () => {
          try {
            const [yy, mm] = today.split('-').map(Number)
            const daysInMonth = new Date(yy, mm, 0).getDate()
            const dateFrom = `${yy}-${String(mm).padStart(2, '0')}-01`
            const dateTo = `${yy}-${String(mm).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
            const res = await withTimeout(
              attendanceApi.getMonthlyBulk({ month: mm, year: yy, academic_year: activeAcademicYearId }),
              PRELOAD_TIMEOUT_MS * 2,
            )
            const byClass = res?.data?.by_class || {}
            for (const [scId, records] of Object.entries(byClass)) {
              queryClient.setQueryData(
                ['attendanceRecords', dateFrom, dateTo, scId, activeAcademicYearId],
                { data: { results: records } },
              )
            }
          } catch (err) {
            if (PRELOAD_DEBUG) console.warn('[preload] monthly_bulk (admin) failed', err?.message)
          }
        })
      }
    } else if (effectiveRole === 'HR_MANAGER') {
      if (isModuleAvailable({ moduleKey: 'hr', enabledModules, isSuperAdmin })) {
        addPrefetch(['hrDashboardStats'], () => hrApi.getDashboardStats())
        addPrefetch(['pendingLeaves'], () => hrApi.getLeaveApplications({ status: 'PENDING', page_size: 5 }))
        addPrefetch(['payrollSummary', currentMonth, currentYear], () => hrApi.getPayrollSummary({ month: currentMonth, year: currentYear }))
        addPrefetch(['staffAttendanceSummary', monthStart, today], () => hrApi.getAttendanceSummary({ date_from: monthStart, date_to: today }))
        addPrefetch(['hrManagerDayStatus', today], () => sessionsApi.getCalendarDayStatus({ date_from: today, date_to: today }))
      }
    } else if (effectiveRole === 'ACCOUNTANT') {
      if (isModuleAvailable({ moduleKey: 'finance', enabledModules, isSuperAdmin })) {
        const dateFrom = monthStart
        const dateTo = today
        addPrefetch(['accountBalances'], () => financeApi.getAccountBalances())
        addPrefetch(
          ['feeSummary', currentMonth, currentYear, activeAcademicYearId],
          () => financeApi.getMonthlySummary({ month: currentMonth, year: currentYear, ...(activeAcademicYearId && { academic_year: activeAcademicYearId }) }),
        )
        addPrefetch(['financeSummaryDash', dateFrom, dateTo], () => financeApi.getFinanceSummary({ date_from: dateFrom, date_to: dateTo }))
        addPrefetch(['recentEntries'], () => financeApi.getRecentEntries({ limit: 8 }))
        addPrefetch(['overdueFees', currentMonth, currentYear], () => financeApi.getFeePayments({ status: 'UNPAID', ordering: '-due_date', page_size: 8 }))
      }
    } else if (effectiveRole === 'STAFF') {
      if (isModuleAvailable({ moduleKey: 'hr', enabledModules, isSuperAdmin })) {
        addPrefetch(['myStaffRecord', userData.id], () => hrApi.getStaff({ user: userData.id, page_size: 1 }))
        tierBTasks.push(async () => {
          try {
            const staffRes = await withTimeout(
              queryClient.fetchQuery({
                queryKey: ['myStaffRecord', userData.id],
                queryFn: () => hrApi.getStaff({ user: userData.id, page_size: 1 }),
                staleTime: 2 * 60 * 1000,
              }),
              PRELOAD_TIMEOUT_MS,
            )
            const myStaff = normalizeListResponse(staffRes?.data)?.[0]
            const myStaffId = myStaff?.id
            if (!myStaffId) return

            await Promise.allSettled([
              queryClient.prefetchQuery({
                queryKey: ['myStaffAttendance', myStaffId, monthStart, today],
                queryFn: () => hrApi.getStaffAttendance({
                  staff_member: myStaffId,
                  date_from: monthStart,
                  date_to: today,
                  page_size: 50,
                }),
              }),
              queryClient.prefetchQuery({
                queryKey: ['myStaffAttendanceSummary', myStaffId, monthStart, today],
                queryFn: () => hrApi.getAttendanceSummary({
                  staff_member: myStaffId,
                  date_from: monthStart,
                  date_to: today,
                }),
              }),
              queryClient.prefetchQuery({
                queryKey: ['myLeaveBalance', myStaffId],
                queryFn: () => hrApi.getLeaveBalance(myStaffId),
              }),
              queryClient.prefetchQuery({
                queryKey: ['myPayslips', myStaffId],
                queryFn: () => hrApi.getPayslips({
                  staff_member: myStaffId,
                  page_size: 3,
                  ordering: '-pay_period_end',
                }),
              }),
            ])
          } catch (error) {
            if (PRELOAD_DEBUG) {
              console.warn('[preload] staff chain failed', error?.message || error)
            }
          }
        })
      }
      if (isModuleAvailable({ moduleKey: 'inventory', enabledModules, isSuperAdmin })) {
        addPrefetch(['myInventoryAssignments', userData.id], () => inventoryApi.getAssignments({ user: userData.id, page_size: 5 }))
      }
    } else if (effectiveRole === 'DRIVER') {
      if (isModuleAvailable({ moduleKey: 'transport', enabledModules, isSuperAdmin })) {
        addPrefetch(['transport-dashboard'], () => transportApi.getDashboardStats())
      }
    } else {
      if (isModuleAvailable({ moduleKey: 'attendance', enabledModules, isSuperAdmin })) {
        addPrefetch(['dailyReport', today, school.id, activeAcademicYearId], () => attendanceApi.getDailyReport(today, school.id, activeAcademicYearId))
        addPrefetch(
          ['pendingReviews', activeAcademicYearId],
          () => attendanceApi.getPendingReviews({ ...(activeAcademicYearId && { academic_year: activeAcademicYearId }) }),
        )
      }
      if (isModuleAvailable({ moduleKey: 'finance', enabledModules, isSuperAdmin })) {
        addPrefetch(
          ['financeSummaryDashboard', currentMonth, currentYear, activeAcademicYearId],
          () => financeApi.getMonthlySummary({ month: currentMonth, year: currentYear, ...(activeAcademicYearId && { academic_year: activeAcademicYearId }) }),
        )
      }
      if (isModuleAvailable({ moduleKey: 'hr', enabledModules, isSuperAdmin })) {
        addPrefetch(['hrDashboardStats'], () => hrApi.getDashboardStats())
      }
      if (isModuleAvailable({ moduleKey: 'admissions', enabledModules, isSuperAdmin })) {
        addPrefetch(['admissionsNewCount'], () => admissionsApi.getEnquiries({ status: 'NEW', page_size: 1 }))
      }
      if (isModuleAvailable({ moduleKey: 'examinations', enabledModules, isSuperAdmin })) {
        addPrefetch(
          ['upcomingExams', activeAcademicYearId],
          () => examinationsApi.getExams({ status: 'SCHEDULED', page_size: 1, academic_year: activeAcademicYearId || undefined }),
        )
      }
      if (isModuleAvailable({ moduleKey: 'transport', enabledModules, isSuperAdmin })) {
        addPrefetch(['transportDashboard'], () => transportApi.getDashboardStats())
      }
      if (isModuleAvailable({ moduleKey: 'library', enabledModules, isSuperAdmin })) {
        addPrefetch(['libraryStats'], () => libraryApi.getStats())
      }
      if (isModuleAvailable({ moduleKey: 'hostel', enabledModules, isSuperAdmin })) {
        addPrefetch(['hostelDashboard'], () => hostelApi.getDashboard())
      }
      if (isModuleAvailable({ moduleKey: 'inventory', enabledModules, isSuperAdmin })) {
        addPrefetch(['inventoryDashboard'], () => inventoryApi.getDashboard())
      }
      addPrefetch(['aiInsights'], () => tasksApi.getAIInsights(), 5 * 60 * 1000)
    }

    if (PRELOAD_DEBUG) {
      console.info('[preload] tier counts', {
        role: effectiveRole,
        tierA: tierATasks.length,
        tierB: tierBTasks.length,
      })
    }

    await runQueue(tierATasks, 'A')
    telemetry.tierAScheduleMs = Math.max(0, Math.round(nowMs() - preloadStartMs))

    if (!tierBTasks.length || !PRELOAD_TIER_B_ENABLED) {
      savePreloadTelemetry({
        ...telemetry,
        totalDurationMs: Math.max(0, Math.round(nowMs() - preloadStartMs)),
      })
    }

    scheduleTierB(tierBTasks)
  }, [queryClient])

  const logout = useCallback(() => {
    clearAuthState()
    lastPreloadFingerprintRef.current = ''

    // Clear academic year preferences for all schools in both storage scopes.
    const clearAcademicYearKeys = (storage) => {
      const keysToRemove = []
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key && key.startsWith('active_academic_year_')) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(key => storage.removeItem(key))
    }

    clearAcademicYearKeys(window.localStorage)
    clearAcademicYearKeys(window.sessionStorage)

    // Clear React Query cache to prevent data leakage between users
    queryClient.clear()

    setUser(null)
    setActiveSchool(null)
  }, [queryClient])

  // Auto-logout after 30 minutes of inactivity
  const inactivityTimer = useRef(null)
  const INACTIVITY_TIMEOUT = 30 * 60 * 1000 // 30 minutes

  useEffect(() => {
    if (!user) return

    const resetTimer = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      inactivityTimer.current = setTimeout(() => {
        logout()
        window.location.href = '/login'
      }, INACTIVITY_TIMEOUT)
    }

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }))
    resetTimer() // start the timer

    return () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      events.forEach(e => window.removeEventListener(e, resetTimer))
    }
  }, [user, logout])

  const switchSchool = async (schoolId) => {
    if (isSwitchingSchool) return
    setIsSwitchingSchool(true)
    try {
      const response = await authApi.switchSchool(schoolId)
      const { school_id, school_name, role } = response.data

      setActiveSchoolId(String(school_id))

      // Stop old-school requests and clear stale cache before rehydration.
      await queryClient.cancelQueries()
      queryClient.clear()

      const freshUser = await refreshUser()
      const resolvedSchool = resolveActiveSchool(freshUser)

      if (resolvedSchool) {
        setActiveSchool(resolvedSchool)
        setActiveSchoolId(String(resolvedSchool.id))
        void preloadVisibleData(freshUser, resolvedSchool)
      } else {
        setActiveSchool({ id: school_id, name: school_name, role })
      }
    } catch (error) {
      if (activeSchool?.id) {
        // Restore storage to previously active school on failure.
        setActiveSchoolId(String(activeSchool.id))
      }
      console.error('Failed to switch school:', error)
      throw error
    } finally {
      setIsSwitchingSchool(false)
    }
  }

  // Determine role based on active school membership
  const effectiveRole = activeSchool?.role || user?.role
  const isSchoolAdmin = user?.is_super_admin || effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'PRINCIPAL'
  const isStaffLevel = ['STAFF', 'TEACHER', 'HR_MANAGER', 'ACCOUNTANT', 'DRIVER'].includes(effectiveRole)
  const isDriver = effectiveRole === 'DRIVER'
  const isParent = effectiveRole === 'PARENT'
  const isStudent = effectiveRole === 'STUDENT'

  // Module access: derived from the active school's enabled_modules
  const enabledModules = activeSchool?.enabled_modules || {}
  const isModuleEnabled = useCallback((moduleKey) => {
    // Super admin sees everything (they manage modules, not use them)
    if (user?.is_super_admin) return true
    const moduleConfig = enabledModules?.[moduleKey]
    if (typeof moduleConfig === 'boolean') return moduleConfig
    if (moduleConfig && typeof moduleConfig === 'object') return !!moduleConfig.enabled
    return false
  }, [user?.is_super_admin, enabledModules])

  // Role hierarchy: which roles can the current user create?
  const getAllowableRoles = useCallback(() => {
    if (user?.is_super_admin) return ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER']
    if (effectiveRole === 'SCHOOL_ADMIN') return ['PRINCIPAL', 'HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER']
    if (effectiveRole === 'PRINCIPAL') return ['HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER']
    return []
  }, [user?.is_super_admin, effectiveRole])

  const value = useMemo(() => ({
    user,
    activeSchool,
    loading,
    isSwitchingSchool,
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
    isDriver,
    isParent,
    isStudent,
    isStaffLevel,
    effectiveRole,
    enabledModules,
    isModuleEnabled,
    getAllowableRoles,
  }), [user, activeSchool, loading, isSwitchingSchool, effectiveRole, enabledModules, isModuleEnabled, getAllowableRoles, logout, switchSchool, refreshUser, isSchoolAdmin, isParent, isStudent, isStaffLevel])

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
