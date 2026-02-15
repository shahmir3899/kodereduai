import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import {
  getAccessToken,
  getRefreshToken,
  getActiveSchoolId,
  setAccessToken,
  clearTokens,
} from './auth';

// TODO: Change this to your backend URL
// For local dev with Android emulator: http://10.0.2.2:8000
// For local dev with iOS simulator: http://localhost:8000
// For production: https://your-backend-url.com
const API_URL = 'http://10.0.2.2:8000';

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

    if (error.response?.status === 401 && !originalRequest._retry) {
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
          await clearTokens();
          onLogout?.();
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      } else {
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
  getMonthlySummary: (params?: Record<string, unknown>) =>
    api.get('/api/finance/fee-payments/monthly_summary/', { params }),
  getStudentLedger: (params?: Record<string, unknown>) =>
    api.get('/api/finance/fee-payments/student_ledger/', { params }),

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
  approveLeave: (id: number, data?: Record<string, unknown>) =>
    api.post(`/api/hr/leave-applications/${id}/approve/`, data),
  rejectLeave: (id: number, data?: Record<string, unknown>) =>
    api.post(`/api/hr/leave-applications/${id}/reject/`, data),
};

// ─── Academics API ───────────────────────────────────────────────────────────

export const academicsApi = {
  getTimetableByClass: (classId: number) =>
    api.get('/api/academics/timetable-entries/by_class/', { params: { class_id: classId } }),
  sendChatMessage: (data: Record<string, unknown>) =>
    api.post('/api/academics/ai-chat/', data),
  getChatHistory: () =>
    api.get('/api/academics/ai-chat/'),
  clearChatHistory: () =>
    api.delete('/api/academics/ai-chat/'),
};

// ─── Examinations API ────────────────────────────────────────────────────────

export const examinationsApi = {
  getExams: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/exams/', { params }),
  getExamResults: (id: number) =>
    api.get(`/api/examinations/exams/${id}/results/`),
  getClassSummary: (id: number) =>
    api.get(`/api/examinations/exams/${id}/class_summary/`),
  getReportCard: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/report-card/', { params }),
};

// ─── Auth API ────────────────────────────────────────────────────────────────

export const authApi = {
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
  getPaymentGateways: (studentId: number) =>
    api.get(`/api/parents/children/${studentId}/pay-fee/`),
  initiatePayment: (studentId: number, data: Record<string, unknown>) =>
    api.post(`/api/parents/children/${studentId}/pay-fee/`, data),
  getChildTimetable: (studentId: number) =>
    api.get(`/api/parents/children/${studentId}/timetable/`),
  getChildExamResults: (studentId: number, params?: Record<string, unknown>) =>
    api.get(`/api/parents/children/${studentId}/exam-results/`, { params }),
  getLeaveRequests: (params?: Record<string, unknown>) =>
    api.get('/api/parents/leave-requests/', { params }),
  createLeaveRequest: (data: Record<string, unknown>) =>
    api.post('/api/parents/leave-requests/', data),
  cancelLeaveRequest: (id: number) =>
    api.patch(`/api/parents/leave-requests/${id}/cancel/`),
  getMessageThreads: () =>
    api.get('/api/parents/messages/threads/'),
  getThreadMessages: (threadId: number) =>
    api.get(`/api/parents/messages/threads/${threadId}/`),
  sendMessage: (data: Record<string, unknown>) =>
    api.post('/api/parents/messages/', data),
  markMessageRead: (id: number) =>
    api.patch(`/api/parents/messages/${id}/read/`),
  // Admin
  getAdminLeaveRequests: (params?: Record<string, unknown>) =>
    api.get('/api/parents/admin/leave-requests/', { params }),
  reviewLeaveRequest: (id: number, data: Record<string, unknown>) =>
    api.patch(`/api/parents/admin/leave-requests/${id}/review/`, data),
};

// ─── Student Portal API ──────────────────────────────────────────────────────

export const studentPortalApi = {
  getDashboard: () =>
    api.get('/api/student-portal/dashboard/'),
  getProfile: () =>
    api.get('/api/student-portal/profile/'),
  getAttendance: (params?: Record<string, unknown>) =>
    api.get('/api/student-portal/attendance/', { params }),
  getFees: (params?: Record<string, unknown>) =>
    api.get('/api/student-portal/fees/', { params }),
  getTimetable: () =>
    api.get('/api/student-portal/timetable/'),
  getExamResults: (params?: Record<string, unknown>) =>
    api.get('/api/student-portal/exam-results/', { params }),
  getAssignments: (params?: Record<string, unknown>) =>
    api.get('/api/student-portal/assignments/', { params }),
  getAssignment: (id: number) =>
    api.get(`/api/student-portal/assignments/${id}/`),
  submitAssignment: (id: number, data: Record<string, unknown>) =>
    api.post(`/api/student-portal/assignments/${id}/submit/`, data),
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
  // GPS Journey
  startJourney: (data: { journey_type: string; latitude: number; longitude: number }) =>
    api.post('/api/transport/journey/start/', data),
  endJourney: (data: { journey_id: number; latitude?: number; longitude?: number }) =>
    api.post('/api/transport/journey/end/', data),
  updateJourney: (data: { journey_id: number; latitude: number; longitude: number; accuracy: number; speed?: number | null; battery_level?: number | null }) =>
    api.post('/api/transport/journey/update/', data),
  trackStudent: (studentId: number) =>
    api.get(`/api/transport/journey/track/${studentId}/`),
  getJourneyHistory: (studentId: number) =>
    api.get(`/api/transport/journey/history/${studentId}/`),
  getActiveJourneys: () =>
    api.get('/api/transport/journey/active/'),
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
