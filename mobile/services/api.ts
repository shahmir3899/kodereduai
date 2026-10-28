import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import {
  getAccessToken,
  getRefreshToken,
  getActiveSchoolId,
  setAccessToken,
  clearTokens,
} from './auth';
import { isAuthEndpoint, refreshEndsSession } from './sessionRules';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

const APP_ENV = String(extra.appEnv ?? process.env.EXPO_PUBLIC_APP_ENV ?? 'development');
const ALLOW_INSECURE_HTTP =
  String(extra.allowInsecureHttp ?? process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP ?? 'false').toLowerCase() === 'true';
const API_URL = String(extra.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000');

if (APP_ENV === 'production' && API_URL.startsWith('http://') && !ALLOW_INSECURE_HTTP) {
  throw new Error('Insecure API URL is blocked in production. Configure an HTTPS API URL.');
}

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Track if we're currently refreshing to avoid infinite loops
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Logout callback — set by AuthContext
let onLogout: (() => void) | null = null;
// Only called when the server has ended the session (refresh token rejected or missing).
export function setLogoutCallback(cb: () => void) {
  onLogout = cb;
}

// Request interceptor — add auth token + school header
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const schoolId = await getActiveSchoolId();
    if (schoolId) {
      config.headers['X-School-ID'] = schoolId;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — handle 401 with token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isAuthEndpoint(originalRequest.url)
    ) {
      if (isRefreshing) {
        // Queue this request while refresh is in progress
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = await getRefreshToken();

      if (refreshToken) {
        try {
          const response = await axios.post(`${API_URL}/api/auth/refresh/`, {
            refresh: refreshToken,
          });
          const { access } = response.data;
          await setAccessToken(access);

          processQueue(null, access);
          originalRequest.headers.Authorization = `Bearer ${access}`;
          return api(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError, null);
          if (refreshEndsSession(refreshError as AxiosError)) {
            await clearTokens();
            onLogout?.();
          }
          // Otherwise the connection failed, not the session: keep the tokens and let the
          // caller's own error state show.
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      } else {
        // Without this reset every later 401 would queue behind a refresh that never ends.
        isRefreshing = false;
        processQueue(error, null);
        await clearTokens();
        onLogout?.();
      }
    }

    return Promise.reject(error);
  }
);

export default api;

// ─── Attendance API ──────────────────────────────────────────────────────────

export const attendanceApi = {
  uploadImageToStorage: (formData: FormData) =>
    api.post('/api/attendance/upload-image/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  createUpload: (data: Record<string, unknown>) =>
    api.post('/api/attendance/uploads/', data),
  getUploads: (params?: Record<string, unknown>) =>
    api.get('/api/attendance/uploads/', { params }),
  getUploadDetails: (id: number) =>
    api.get(`/api/attendance/uploads/${id}/`),
  confirmAttendance: (id: number, data: Record<string, unknown>) =>
    api.post(`/api/attendance/uploads/${id}/confirm/`, data),
  getPendingReviews: () =>
    api.get('/api/attendance/uploads/pending_review/'),
  getRecords: (params?: Record<string, unknown>) =>
    api.get('/api/attendance/records/', { params }),
  getDailyReport: (date: string, schoolId: number) =>
    api.get('/api/attendance/records/daily_report/', { params: { date, school_id: schoolId } }),
  getChronicAbsentees: (params?: Record<string, unknown>) =>
    api.get('/api/attendance/records/chronic_absentees/', { params }),
  reprocessUpload: (id: number) =>
    api.post(`/api/attendance/uploads/${id}/reprocess/`),
  deleteUpload: (id: number) =>
    api.delete(`/api/attendance/uploads/${id}/`),
  getAIStatus: () =>
    api.get('/api/attendance/ai-status/'),
  // Classes the signed-in teacher may mark (master classes; admins get every class).
  getMyClasses: () =>
    api.get('/api/attendance/records/my_classes/'),
  // Lightweight (student_id, date, status) rows for the register; no pagination.
  getRegisterData: (params?: Record<string, unknown>) =>
    api.get('/api/attendance/records/register_data/', { params }),
  bulkEntry: (data: Record<string, unknown>) =>
    api.post('/api/attendance/records/bulk_entry/', data),
};

// ─── LMS API ─────────────────────────────────────────────────────────────────

export const lmsApi = {
  getBooks: (params?: Record<string, unknown>) =>
    api.get('/api/lms/books/', { params }),
  getBookTree: (id: number) =>
    api.get(`/api/lms/books/${id}/tree/`),
  getAssignments: (params?: Record<string, unknown>) =>
    api.get('/api/lms/assignments/', { params }),
  getAssignment: (id: number) =>
    api.get(`/api/lms/assignments/${id}/`),
  createAssignment: (data: Record<string, unknown>) =>
    api.post('/api/lms/assignments/', data),
  updateAssignment: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/lms/assignments/${id}/`, data),
  deleteAssignment: (id: number) =>
    api.delete(`/api/lms/assignments/${id}/`),
  publishAssignment: (id: number) =>
    api.post(`/api/lms/assignments/${id}/publish/`),
  closeAssignment: (id: number) =>
    api.post(`/api/lms/assignments/${id}/close/`),
  getSubmissions: (params?: Record<string, unknown>) =>
    api.get('/api/lms/submissions/', { params }),
  gradeSubmission: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/lms/submissions/${id}/grade/`, data),
  returnSubmission: (id: number) =>
    api.post(`/api/lms/submissions/${id}/return/`),
};

// ─── Sessions API (academic years, session classes, enrolments, calendar) ───

export const sessionsApi = {
  getAcademicYears: (params?: Record<string, unknown>) =>
    api.get('/api/sessions/academic-years/', { params }),
  getSessionClasses: (params?: Record<string, unknown>) =>
    api.get('/api/sessions/session-classes/', { params }),
  getEnrollments: (params?: Record<string, unknown>) =>
    api.get('/api/sessions/enrollments/', { params }),
  getCalendarMonthView: (params?: Record<string, unknown>) =>
    api.get('/api/sessions/calendar-entries/month-view/', { params }),
  getCalendarDayStatus: (params?: Record<string, unknown>) =>
    api.get('/api/sessions/calendar-entries/day-status/', { params }),
};

// ─── Bootstrap API (one-request dashboards) ─────────────────────────────────

export const bootstrapApi = {
  // sections: comma-separated, any of attendance,hr,finance,admissions,transport,library,hostel,inventory
  getAdminDashboard: (params?: Record<string, unknown>) =>
    api.get('/api/bootstrap/admin-dashboard/', { params }),
};

// ─── Students API ────────────────────────────────────────────────────────────

export const studentsApi = {
  getStudents: (params?: Record<string, unknown>) =>
    api.get('/api/students/', { params }),
  getStudent: (id: number) =>
    api.get(`/api/students/${id}/`),
  createStudent: (data: Record<string, unknown>) =>
    api.post('/api/students/', data),
  updateStudent: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/students/${id}/`, data),
  deleteStudent: (id: number) =>
    api.delete(`/api/students/${id}/`),
  getStudentsByClass: (params?: Record<string, unknown>) =>
    api.get('/api/students/by_class/', { params }),
  getProfileSummary: (id: number) =>
    api.get(`/api/students/${id}/profile_summary/`),
  getAttendanceHistory: (id: number, params?: Record<string, unknown>) =>
    api.get(`/api/students/${id}/attendance_history/`, { params }),
  getFeeLedger: (id: number) =>
    api.get(`/api/students/${id}/fee_ledger/`),
  getExamResults: (id: number) =>
    api.get(`/api/students/${id}/exam_results/`),
};

// ─── Classes API ─────────────────────────────────────────────────────────────

export const classesApi = {
  getClasses: (params?: Record<string, unknown>) =>
    api.get('/api/classes/', { params }),
  getClass: (id: number) =>
    api.get(`/api/classes/${id}/`),
};

// ─── Finance API ─────────────────────────────────────────────────────────────

export const financeApi = {
  // Fee Payments
  getFeePayments: (params?: Record<string, unknown>) =>
    api.get('/api/finance/fee-payments/', { params }),
  recordPayment: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/finance/fee-payments/${id}/`, data),
  createPayment: (data: Record<string, unknown>) =>
    api.post('/api/finance/fee-payments/', data),
  getAccounts: (params?: Record<string, unknown>) =>
    api.get('/api/finance/accounts/', { params }),
  getMonthlySummary: (params?: Record<string, unknown>) =>
    api.get('/api/finance/fee-payments/monthly_summary/', { params }),
  getStudentLedger: (params?: Record<string, unknown>) =>
    api.get('/api/finance/fee-payments/student_ledger/', { params }),
  getAccountBalances: (params?: Record<string, unknown>) =>
    api.get('/api/finance/accounts/balances/', { params }),
  getRecentEntries: (params?: Record<string, unknown>) =>
    api.get('/api/finance/accounts/recent_entries/', { params }),

  // Expenses
  getExpenses: (params?: Record<string, unknown>) =>
    api.get('/api/finance/expenses/', { params }),
  createExpense: (data: Record<string, unknown>) =>
    api.post('/api/finance/expenses/', data),
  updateExpense: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/finance/expenses/${id}/`, data),
  deleteExpense: (id: number) =>
    api.delete(`/api/finance/expenses/${id}/`),

  // Other Income
  getOtherIncome: (params?: Record<string, unknown>) =>
    api.get('/api/finance/other-income/', { params }),
  createOtherIncome: (data: Record<string, unknown>) =>
    api.post('/api/finance/other-income/', data),

  // Reports
  getFinanceSummary: (params?: Record<string, unknown>) =>
    api.get('/api/finance/reports/', { params }),
  getMonthlyTrend: (params?: Record<string, unknown>) =>
    api.get('/api/finance/reports/', { params: { ...params, type: 'monthly_trend' } }),

  // AI Chat
  sendChatMessage: (data: Record<string, unknown>) =>
    api.post('/api/finance/ai-chat/', data),
  getChatHistory: () =>
    api.get('/api/finance/ai-chat/'),
  clearChatHistory: () =>
    api.delete('/api/finance/ai-chat/'),
};

// ─── HR API ──────────────────────────────────────────────────────────────────

export const hrApi = {
  getDashboardStats: () =>
    api.get('/api/hr/staff/dashboard_stats/'),
  getStaff: (params?: Record<string, unknown>) =>
    api.get('/api/hr/staff/', { params }),
  getStaffMember: (id: number) =>
    api.get(`/api/hr/staff/${id}/`),
  getLeaveApplications: (params?: Record<string, unknown>) =>
    api.get('/api/hr/leave-applications/', { params }),
  getLeavePolicies: (params?: Record<string, unknown>) =>
    api.get('/api/hr/leave-policies/', { params }),
  createLeaveApplication: (data: Record<string, unknown>) =>
    api.post('/api/hr/leave-applications/', data),
  cancelLeave: (id: number) =>
    api.post(`/api/hr/leave-applications/${id}/cancel/`),
  getLeaveBalance: (staffMemberId: number) =>
    api.get('/api/hr/leave-applications/leave_balance/', { params: { staff_member: staffMemberId } }),
  getStaffAttendance: (params?: Record<string, unknown>) =>
    api.get('/api/hr/attendance/', { params }),
  getAttendanceSummary: (params?: Record<string, unknown>) =>
    api.get('/api/hr/attendance/summary/', { params }),
  approveLeave: (id: number, data?: Record<string, unknown>) =>
    api.post(`/api/hr/leave-applications/${id}/approve/`, data),
  rejectLeave: (id: number, data?: Record<string, unknown>) =>
    api.post(`/api/hr/leave-applications/${id}/reject/`, data),
  // Own payslips only: the server scopes every non-admin role to their own record.
  getPayslips: (params?: Record<string, unknown>) =>
    api.get('/api/hr/payslips/', { params }),
};

// ─── Inventory API (read-only; staff see only their own assignments) ─────────

export const inventoryApi = {
  getAssignments: (params?: Record<string, unknown>) =>
    api.get('/api/inventory/assignments/', { params }),
};

// ─── Academics API ───────────────────────────────────────────────────────────

export const academicsApi = {
  getSubjects: (params?: Record<string, unknown>) =>
    api.get('/api/academics/subjects/', { params }),
  getMyTimetable: (params?: Record<string, unknown>) =>
    api.get('/api/academics/timetable-entries/my_timetable/', { params }),
  getMyClassTeacherAssignments: (params?: Record<string, unknown>) =>
    api.get('/api/academics/class-teachers/my_classes/', { params }),
  getMyStudentsAtRisk: (params?: Record<string, unknown>) =>
    api.get('/api/academics/class-teachers/my_students_at_risk/', { params }),
  getTimetableByClass: (classId: number, sessionClassId?: number | null) =>
    api.get('/api/academics/timetable-entries/by_class/', {
      params: { class_id: classId, ...(sessionClassId ? { session_class_id: sessionClassId } : {}) },
    }),
  sendChatMessage: (data: Record<string, unknown>) =>
    api.post('/api/academics/ai-chat/', data),
  getChatHistory: () =>
    api.get('/api/academics/ai-chat/'),
  clearChatHistory: () =>
    api.delete('/api/academics/ai-chat/'),
};

// ─── Examinations API ────────────────────────────────────────────────────────

export const examinationsApi = {
  getExamTypes: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/exam-types/', { params }),
  getExamSubjects: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/exam-subjects/', { params }),
  getMarks: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/marks/', { params }),
  // 200 even when it skips rows it rejects: check `errors` in the body.
  bulkEntryMarks: (data: Record<string, unknown>) =>
    api.post('/api/examinations/marks/bulk_entry/', data),
  getExams: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/exams/', { params }),
  getQuestions: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/questions/', { params }),
  getExamPapers: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/exam-papers/', { params }),
  getWorksheets: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/worksheets/', { params }),
  getExamResults: (id: number, params?: Record<string, unknown>) =>
    api.get(`/api/examinations/exams/${id}/results/`, { params }),
  getStudentTermAssessmentRoster: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/student-term-assessment/roster/', { params }),
  bulkSaveStudentTermAssessment: (data: Record<string, unknown>) =>
    api.post('/api/examinations/student-term-assessment/bulk-save/', data),
  getClassSummary: (id: number) =>
    api.get(`/api/examinations/exams/${id}/class_summary/`),
  getReportCard: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/report-card/', { params }),
};

// ─── Auth API ────────────────────────────────────────────────────────────────

export const authApi = {
  // Always answers 200, whether or not the email exists.
  requestPasswordReset: (email: string) =>
    api.post('/api/auth/password-reset/', { email }),
  switchSchool: (schoolId: number) =>
    api.post('/api/auth/switch-school/', { school_id: schoolId }),
  updateProfile: (data: Record<string, unknown>) =>
    api.patch('/api/auth/me/', data),
  changePassword: (data: Record<string, unknown>) =>
    api.post('/api/auth/change-password/', data),
  registerPushToken: (data: { token: string; device_type: string }) =>
    api.post('/api/auth/register-push-token/', data),
  unregisterPushToken: (data: { token: string }) =>
    api.delete('/api/auth/unregister-push-token/', { data }),
};

// ─── Notifications API ───────────────────────────────────────────────────────

export const notificationsApi = {
  getTemplates: (params?: Record<string, unknown>) =>
    api.get('/api/notifications/templates/', { params }),
  getLogs: (params?: Record<string, unknown>) =>
    api.get('/api/notifications/logs/', { params }),
  getMyNotifications: (params?: Record<string, unknown>) =>
    api.get('/api/notifications/my/', { params }),
  getUnreadCount: () =>
    api.get('/api/notifications/unread-count/'),
  markRead: (id: number) =>
    api.post(`/api/notifications/${id}/mark-read/`),
  markAllRead: () =>
    api.post('/api/notifications/mark-all-read/'),
  send: (data: Record<string, unknown>) =>
    api.post('/api/notifications/send/', data),
  sendChatMessage: (data: Record<string, unknown>) =>
    api.post('/api/notifications/ai-chat/', data),
};

// ─── Parents API ─────────────────────────────────────────────────────────────

export const parentsApi = {
  register: (data: Record<string, unknown>) =>
    api.post('/api/parents/register/', data),
  getMyChildren: () =>
    api.get('/api/parents/my-children/'),
  getChildOverview: (studentId: number) =>
    api.get(`/api/parents/children/${studentId}/overview/`),
  getChildAttendance: (studentId: number, params?: Record<string, unknown>) =>
    api.get(`/api/parents/children/${studentId}/attendance/`, { params }),
  getChildFees: (studentId: number, params?: Record<string, unknown>) =>
    api.get(`/api/parents/children/${studentId}/fees/`, { params }),
  getChildTimetable: (studentId: number) =>
    api.get(`/api/parents/children/${studentId}/timetable/`),
  getChildLibrary: (studentId: number) =>
    api.get(`/api/parents/children/${studentId}/library/`),
  getChildTransport: (studentId: number) =>
    api.get(`/api/parents/children/${studentId}/transport/`),
  getChildExamSchedule: (studentId: number) =>
    api.get(`/api/parents/children/${studentId}/exam-schedule/`),
  getChildExamResults: (studentId: number, params?: Record<string, unknown>) =>
    api.get(`/api/parents/children/${studentId}/exam-results/`, { params }),
  getLeaveRequests: (params?: Record<string, unknown>) =>
    api.get('/api/parents/leave-requests/', { params }),
  createLeaveRequest: (data: Record<string, unknown>) =>
    api.post('/api/parents/leave-requests/', data),
  // Cancel is the viewset's DELETE (it soft-cancels a pending request); there is no /cancel/ route.
  // Parents message teachers through /api/messaging (messagingApi), not /api/parents/messages.
  cancelLeaveRequest: (id: number) =>
    api.delete(`/api/parents/leave-requests/${id}/`),
  // Admin
  getAdminLeaveRequests: (params?: Record<string, unknown>) =>
    api.get('/api/parents/admin/leave-requests/', { params }),
  reviewLeaveRequest: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/parents/admin/leave-requests/${id}/review/`, data),
};

// ─── Student Portal API ──────────────────────────────────────────────────────

export const studentPortalApi = {
  getDashboard: () =>
    api.get('/api/students/portal/dashboard/'),
  getProfile: () =>
    api.get('/api/students/portal/profile/'),
  getAttendance: (params?: Record<string, unknown>) =>
    api.get('/api/students/portal/attendance/', { params }),
  getFees: (params?: Record<string, unknown>) =>
    api.get('/api/students/portal/fees/', { params }),
  getTimetable: () =>
    api.get('/api/students/portal/timetable/'),
  getExamSchedule: () =>
    api.get('/api/students/portal/exam-schedule/'),
  getExamResults: (params?: Record<string, unknown>) =>
    api.get('/api/students/portal/results/', { params }),
  getAssignments: (params?: Record<string, unknown>) =>
    api.get('/api/students/portal/assignments/', { params }),
  getAssignment: (id: number) =>
    api.get(`/api/students/portal/assignments/${id}/`),
  // The backend has no /<id>/submit/ route: the id goes in the body of the list URL.
  submitAssignment: (id: number, data: Record<string, unknown>) =>
    api.post('/api/students/portal/assignments/', { ...data, assignment_id: id }),
  getLibrary: () =>
    api.get('/api/students/portal/library/'),
  getTransport: () =>
    api.get('/api/students/portal/transport/'),
  getStudyHelperHistory: () =>
    api.get('/api/students/portal/study-helper/'),
  sendStudyHelperMessage: (data: Record<string, unknown>) =>
    api.post('/api/students/portal/study-helper/', data),
  clearStudyHelperHistory: () =>
    api.delete('/api/students/portal/study-helper/'),
};

// ─── Payment API ─────────────────────────────────────────────────────────────

export const paymentApi = {
  getPaymentStatus: (orderId: string) =>
    api.get(`/api/finance/payment-status/${orderId}/`),
};

// ─── Transport API ───────────────────────────────────────────────────────────

export const transportApi = {
  getDashboardStats: () =>
    api.get('/api/transport/dashboard/'),
  getRoutes: (params?: Record<string, unknown>) =>
    api.get('/api/transport/routes/', { params }),
  getVehicles: (params?: Record<string, unknown>) =>
    api.get('/api/transport/vehicles/', { params }),
  getMyVehicle: () =>
    api.get('/api/transport/vehicles/my/'),
  getStops: (params?: Record<string, unknown>) =>
    api.get('/api/transport/stops/', { params }),
  // Student GPS Journey (existing)
  startJourney: (data: { journey_type: string; latitude: number; longitude: number }) =>
    api.post('/api/transport/journey/start/', data),
  endJourney: (data: { journey_id: number; latitude?: number; longitude?: number }) =>
    api.post('/api/transport/journey/end/', data),
  updateJourney: (data: { journey_id: number; latitude: number; longitude: number; accuracy: number; speed?: number | null; battery_level?: number | null }) =>
    api.post('/api/transport/journey/update/', data),
  // Parents follow the route's bus (the legacy journey/track/ is the student's own sharing).
  trackStudent: (studentId: number) =>
    api.get(`/api/transport/route-journey/track/${studentId}/`),
  getJourneyHistory: (studentId: number) =>
    api.get(`/api/transport/journey/history/${studentId}/`),
  getActiveJourneys: () =>
    api.get('/api/transport/journey/active/'),
  // Route Journey (driver/admin)
  startRouteJourney: (data: { journey_type: string; latitude?: number; longitude?: number; route_id?: number }) =>
    api.post('/api/transport/route-journey/start/', data),
  endRouteJourney: (data: { journey_id: number }) =>
    api.post('/api/transport/route-journey/end/', data),
  updateRouteJourney: (data: { journey_id: number; latitude: number; longitude: number; accuracy: number; speed?: number | null; battery_level?: number | null }) =>
    api.post('/api/transport/route-journey/update/', data),
  getActiveRouteJourneys: () =>
    api.get('/api/transport/route-journey/active/'),
  getRouteJourneyHistory: (params?: Record<string, unknown>) =>
    api.get('/api/transport/route-journey/history/', { params }),
  // Driver boarding: the route comes from the driver's own vehicle, and only today can be marked.
  getDriverBoarding: () =>
    api.get('/api/transport/driver/boarding/'),
  markDriverBoarding: (records: Array<{ student_id: number; boarding_status: string }>) =>
    api.post('/api/transport/driver/boarding/', { records }),
};

// ─── Library API ─────────────────────────────────────────────────────────────

export const libraryApi = {
  getStats: () =>
    api.get('/api/library/stats/'),
  getBooks: (params?: Record<string, unknown>) =>
    api.get('/api/library/books/', { params }),
  createIssue: (data: Record<string, unknown>) =>
    api.post('/api/library/issues/', data),
  searchStudents: (params?: Record<string, unknown>) =>
    api.get('/api/students/', { params }),
};

// ─── Hostel API ──────────────────────────────────────────────────────────────

export const hostelApi = {
  getDashboard: () =>
    api.get('/api/hostel/dashboard/'),
  getGatePasses: (params?: Record<string, unknown>) =>
    api.get('/api/hostel/gate-passes/', { params }),
  approveGatePass: (id: number, data?: Record<string, unknown>) =>
    api.patch(`/api/hostel/gate-passes/${id}/approve/`, data),
  rejectGatePass: (id: number, data?: Record<string, unknown>) =>
    api.patch(`/api/hostel/gate-passes/${id}/reject/`, data),
  checkoutGatePass: (id: number) =>
    api.patch(`/api/hostel/gate-passes/${id}/checkout/`),
  returnGatePass: (id: number) =>
    api.patch(`/api/hostel/gate-passes/${id}/return/`),
};

// Face Attendance (Camera-Based)
export const faceAttendanceApi = {
  uploadImage: (formData: FormData) =>
    api.post('/api/face-attendance/upload-image/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  createSession: (data: Record<string, unknown>) =>
    api.post('/api/face-attendance/sessions/', data),
  getSessions: (params?: Record<string, unknown>) =>
    api.get('/api/face-attendance/sessions/', { params }),
  getSession: (id: string) =>
    api.get(`/api/face-attendance/sessions/${id}/`),
  getPendingReview: (params?: Record<string, unknown>) =>
    api.get('/api/face-attendance/sessions/pending_review/', { params }),
  confirmSession: (id: string, data: Record<string, unknown>) =>
    api.post(`/api/face-attendance/sessions/${id}/confirm/`, data),
  reprocessSession: (id: string) =>
    api.post(`/api/face-attendance/sessions/${id}/reprocess/`),
  enrollFace: (data: Record<string, unknown>) =>
    api.post('/api/face-attendance/enroll/', data),
  getEnrollments: (params?: Record<string, unknown>) =>
    api.get('/api/face-attendance/enrollments/', { params }),
  deleteEnrollment: (id: number) =>
    api.delete(`/api/face-attendance/enrollments/${id}/`),
  getStatus: () =>
    api.get('/api/face-attendance/status/'),
};

// ─── Messaging API (staff <-> staff/admin threads; parents use /api/parents/messages) ───

export const messagingApi = {
  getThreads: () => api.get('/api/messaging/threads/'),
  getThread: (id: string) => api.get(`/api/messaging/threads/${id}/`),
  createThread: (data: { recipient_user_id: number; message: string; subject?: string; student_id?: number }) =>
    api.post('/api/messaging/threads/', data),
  reply: (id: string, message: string) =>
    api.post(`/api/messaging/threads/${id}/reply/`, { message }),
  getRecipients: () => api.get('/api/messaging/recipients/'),
  getUnreadCount: () => api.get('/api/messaging/unread-count/'),
};
