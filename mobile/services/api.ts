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
  getLessonPlans: (params?: Record<string, unknown>) => api.get('/api/lms/lesson-plans/', { params }),
  bulkCreateLessonPlans: (data: object) => api.post('/api/lms/lesson-plans/bulk_create/', data),
  // AI draft from chosen topics (uses the school's AI quota; the person edits before saving).
  generateLessonPlan: (data: object) => api.post('/api/lms/generate-lesson-plan/', data, { timeout: 90000 }),
  getBooksForClassSubject: (params?: Record<string, unknown>) => api.get('/api/lms/books/for_class_subject/', { params }),
  createLessonPlan: (data: object) => api.post('/api/lms/lesson-plans/', data),
  updateLessonPlan: (id: number, data: object) => api.patch(`/api/lms/lesson-plans/${id}/`, data),
  deleteLessonPlan: (id: number) => api.delete(`/api/lms/lesson-plans/${id}/`),
  // Curriculum authoring: admin, principal, teacher and manager (CanEditCurriculum).
  createBook: (data: object) => api.post('/api/lms/books/', data),
  updateBook: (id: number, data: object) => api.patch(`/api/lms/books/${id}/`, data),
  createChapter: (data: object) => api.post('/api/lms/chapters/', data),
  updateChapter: (id: number, data: object) => api.patch(`/api/lms/chapters/${id}/`, data),
  deleteChapter: (id: number) => api.delete(`/api/lms/chapters/${id}/`),
  createTopic: (data: object) => api.post('/api/lms/topics/', data),
  updateTopic: (id: number, data: object) => api.patch(`/api/lms/topics/${id}/`, data),
  deleteTopic: (id: number) => api.delete(`/api/lms/topics/${id}/`),
  // Table-of-contents scan: photo -> background job -> text -> parsed outline -> apply.
  createTocJob: (bookId: number, form: FormData) =>
    api.post(`/api/lms/books/${bookId}/ocr_toc/`, form, { headers: { 'Content-Type': 'multipart/form-data' }, params: { async: '1' }, timeout: 120000 }),
  getTocJob: (jobId: string) => api.get(`/api/lms/toc-jobs/${jobId}/`, { timeout: 30000 }),
  parseToc: (bookId: number, data: object) => api.post(`/api/lms/books/${bookId}/parse_toc/`, data),
  applyToc: (bookId: number, data: object) => api.post(`/api/lms/books/${bookId}/apply_toc/`, data),
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
  createSessionClass: (data: object) => api.post('/api/sessions/session-classes/', data),
  updateSessionClass: (id: number, data: object) => api.patch(`/api/sessions/session-classes/${id}/`, data),
  deleteSessionClass: (id: number) => api.delete(`/api/sessions/session-classes/${id}/`),
  // Creates this year's sections from the master classes (existing ones are left alone).
  initializeSessionClasses: (data: object) => api.post('/api/sessions/session-classes/initialize/', data),
  getEnrollments: (params?: Record<string, unknown>) =>
    api.get('/api/sessions/enrollments/', { params }),
  getTerms: (params?: Record<string, unknown>) =>
    api.get('/api/sessions/terms/', { params }),
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
  // Class setup (admin and principal).
  createClass: (data: object) => api.post('/api/classes/', data),
  updateClass: (id: number, data: object) => api.patch(`/api/classes/${id}/`, data),
  deleteClass: (id: number) => api.delete(`/api/classes/${id}/`),
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
  // Fee record generation (admin and principal): preview first, then create real fee rows.
  previewGeneration: (params?: Record<string, unknown>) =>
    api.get('/api/finance/fee-payments/preview_generation/', { params }),
  generateMonthly: (data: object) => api.post('/api/finance/fee-payments/generate_monthly/', data),
  generateAnnualFees: (data: object) => api.post('/api/finance/fee-payments/generate_annual_fees/', data),
  generateSingleFee: (data: object) => api.post('/api/finance/fee-payments/generate_single/', data),
  // Fee structure (admin and principal write; the server replaces a class's charge per category)
  getFeeStructures: (params?: Record<string, unknown>) =>
    api.get('/api/finance/fee-structures/', { params }),
  bulkSetFeeStructures: (data: object) =>
    api.post('/api/finance/fee-structures/bulk_set/', data),
  // Amounts for single students in one class, replacing only the students sent.
  bulkSetStudentFeeStructures: (data: object) =>
    api.post('/api/finance/fee-structures/bulk_set_students/', data),
  getMonthlyCategories: (params?: Record<string, unknown>) =>
    api.get('/api/finance/monthly-categories/', { params }),
  createMonthlyCategory: (data: object) =>
    api.post('/api/finance/monthly-categories/', data),
  getAnnualCategories: (params?: Record<string, unknown>) =>
    api.get('/api/finance/annual-categories/', { params }),
  createAnnualCategory: (data: object) =>
    api.post('/api/finance/annual-categories/', data),
  getAccountBalances: (params?: Record<string, unknown>) =>
    api.get('/api/finance/accounts/balances/', { params }),
  // Transfers between accounts and month closing (admin and principal; accountants are read-only).
  getTransfers: (params?: Record<string, unknown>) =>
    api.get('/api/finance/transfers/', { params }),
  createTransfer: (data: object) => api.post('/api/finance/transfers/', data),
  updateTransfer: (id: number, data: object) => api.patch(`/api/finance/transfers/${id}/`, data),
  deleteTransfer: (id: number) => api.delete(`/api/finance/transfers/${id}/`),
  getClosings: () => api.get('/api/finance/accounts/closings/'),
  closeMonth: (data: { year: number; month: number; notes?: string }) =>
    api.post('/api/finance/accounts/close_month/', data),
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
  getExpenseCategorySummary: (params?: Record<string, unknown>) =>
    api.get('/api/finance/expenses/category_summary/', { params }),
  // Server-made files, read as bytes so they can be written to the phone and shared.
  exportLedgerPdf: (params?: Record<string, unknown>) =>
    api.get('/api/finance/accounts/export-ledger-pdf/', { params, responseType: 'arraybuffer' }),
  exportLedger: (params?: Record<string, unknown>) =>
    api.get('/api/finance/accounts/export-ledger/', { params, responseType: 'arraybuffer' }),

  // AI Chat
  sendChatMessage: (data: Record<string, unknown>) =>
    api.post('/api/finance/ai-chat/', data),
  getChatHistory: () =>
    api.get('/api/finance/ai-chat/'),
  clearChatHistory: () =>
    api.delete('/api/finance/ai-chat/'),
};

// ─── Reports API (server-generated PDFs, the same ones the web downloads) ─────

export const lettersApi = {
  getLetters: (params?: Record<string, unknown>) => api.get('/api/reports/custom-letters/', { params }),
  createLetter: (data: object) => api.post('/api/reports/custom-letters/', data),
  updateLetter: (id: number, data: object) => api.put(`/api/reports/custom-letters/${id}/`, data),
  deleteLetter: (id: number) => api.delete(`/api/reports/custom-letters/${id}/`),
  getTemplates: () => api.get('/api/reports/custom-letters/templates/'),
  prefill: (data: object) => api.post('/api/reports/custom-letters/prefill/', data),
  generatePdf: (data: object) => api.post('/api/reports/custom-letters/generate-pdf/', data, { responseType: 'arraybuffer' }),
};

// Insight cards (admin and principal): the same four risk scans the web pages use.
export const insightsApi = {
  studentRisk: (params?: Record<string, unknown>) => api.get('/api/sessions/student-risk-score/', { params }),
  attendanceRisk: (params?: Record<string, unknown>) => api.get('/api/sessions/attendance-risk/', { params }),
  academicRisk: (params?: Record<string, unknown>) => api.get('/api/examinations/academic-risk/', { params }),
  staffRisk: (params?: Record<string, unknown>) => api.get('/api/hr/staff-risk/', { params }),
};

export const reportsApi = {
  generateInstant: (data: object) =>
    api.post('/api/reports/generate-instant/', data, { responseType: 'arraybuffer' }),
};

// ─── Discounts and scholarships (admin and principal only) ───────────────────

export const discountApi = {
  getDiscounts: (params?: Record<string, unknown>) => api.get('/api/finance/discounts/', { params }),
  createDiscount: (data: object) => api.post('/api/finance/discounts/', data),
  updateDiscount: (id: number, data: object) => api.patch(`/api/finance/discounts/${id}/`, data),
  deleteDiscount: (id: number) => api.delete(`/api/finance/discounts/${id}/`),
  getScholarships: (params?: Record<string, unknown>) => api.get('/api/finance/scholarships/', { params }),
  createScholarship: (data: object) => api.post('/api/finance/scholarships/', data),
  updateScholarship: (id: number, data: object) => api.patch(`/api/finance/scholarships/${id}/`, data),
  deleteScholarship: (id: number) => api.delete(`/api/finance/scholarships/${id}/`),
  getStudentDiscounts: (params?: Record<string, unknown>) => api.get('/api/finance/student-discounts/', { params }),
  assignDiscount: (data: object) => api.post('/api/finance/student-discounts/', data),
  bulkAssign: (data: object) => api.post('/api/finance/student-discounts/bulk_assign/', data),
  removeStudentDiscount: (id: number) => api.delete(`/api/finance/student-discounts/${id}/`),
};

// ─── HR API ──────────────────────────────────────────────────────────────────

export const hrApi = {
  getDashboardStats: () =>
    api.get('/api/hr/staff/dashboard_stats/'),
  getStaff: (params?: Record<string, unknown>) =>
    api.get('/api/hr/staff/', { params }),
  getStaffMember: (id: number) =>
    api.get(`/api/hr/staff/${id}/`),
  // Staff directory writes (admin and principal). Delete only deactivates; reactivate undoes it.
  getNextEmployeeId: () => api.get('/api/hr/staff/next-employee-id/'),
  createStaff: (data: object) => api.post('/api/hr/staff/', data),
  updateStaff: (id: number, data: object) => api.patch(`/api/hr/staff/${id}/`, data),
  deleteStaff: (id: number) => api.delete(`/api/hr/staff/${id}/`),
  reactivateStaff: (id: number) => api.post(`/api/hr/staff/${id}/reactivate/`),
  getDepartments: (params?: Record<string, unknown>) => api.get('/api/hr/departments/', { params }),
  createDepartment: (data: object) => api.post('/api/hr/departments/', data),
  updateDepartment: (id: number, data: object) => api.patch(`/api/hr/departments/${id}/`, data),
  deleteDepartment: (id: number) => api.delete(`/api/hr/departments/${id}/`),
  getDesignations: (params?: Record<string, unknown>) => api.get('/api/hr/designations/', { params }),
  createDesignation: (data: object) => api.post('/api/hr/designations/', data),
  updateDesignation: (id: number, data: object) => api.patch(`/api/hr/designations/${id}/`, data),
  deleteDesignation: (id: number) => api.delete(`/api/hr/designations/${id}/`),
  createLeavePolicy: (data: object) => api.post('/api/hr/leave-policies/', data),
  updateLeavePolicy: (id: number, data: object) => api.patch(`/api/hr/leave-policies/${id}/`, data),
  deleteLeavePolicy: (id: number) => api.delete(`/api/hr/leave-policies/${id}/`),
  getQualifications: (params?: Record<string, unknown>) => api.get('/api/hr/qualifications/', { params }),
  createQualification: (data: object) => api.post('/api/hr/qualifications/', data),
  updateQualification: (id: number, data: object) => api.patch(`/api/hr/qualifications/${id}/`, data),
  deleteQualification: (id: number) => api.delete(`/api/hr/qualifications/${id}/`),
  // Documents go as multipart so the photo or file rides along; a JSON edit keeps the old file.
  getDocuments: (params?: Record<string, unknown>) => api.get('/api/hr/documents/', { params }),
  createDocument: (form: FormData) => api.post('/api/hr/documents/', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }),
  updateDocument: (id: number, data: object) => api.patch(`/api/hr/documents/${id}/`, data),
  deleteDocument: (id: number) => api.delete(`/api/hr/documents/${id}/`),
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
  // Payroll (admin and principal): generation, approval, payment, salary structures.
  getPayrollSummary: (params?: Record<string, unknown>) =>
    api.get('/api/hr/payslips/payroll_summary/', { params }),
  generatePayslips: (data: object) => api.post('/api/hr/payslips/generate_payslips/', data),
  approvePayslip: (id: number) => api.post(`/api/hr/payslips/${id}/approve/`),
  markPayslipPaid: (id: number, data: object) => api.post(`/api/hr/payslips/${id}/mark_paid/`, data),
  deletePayslip: (id: number) => api.delete(`/api/hr/payslips/${id}/`),
  downloadPayslipPdf: (id: number) => api.get(`/api/hr/payslips/${id}/download-pdf/`, { responseType: 'arraybuffer' }),
  getAppraisals: (params?: Record<string, unknown>) => api.get('/api/hr/appraisals/', { params }),
  createAppraisal: (data: object) => api.post('/api/hr/appraisals/', data),
  updateAppraisal: (id: number, data: object) => api.patch(`/api/hr/appraisals/${id}/`, data),
  deleteAppraisal: (id: number) => api.delete(`/api/hr/appraisals/${id}/`),
  getSalaryStructures: (params?: Record<string, unknown>) => api.get('/api/hr/salary-structures/', { params }),
  createSalaryStructure: (data: object) => api.post('/api/hr/salary-structures/', data),
  updateSalaryStructure: (id: number, data: object) => api.patch(`/api/hr/salary-structures/${id}/`, data),
  deleteSalaryStructure: (id: number) => api.delete(`/api/hr/salary-structures/${id}/`),
};

// ─── Inventory API ───────────────────────────────────────────────────────────
// Admin and principal write; accountant reads; teacher and staff only list their own assignments.

export const inventoryApi = {
  getDashboard: () => api.get('/api/inventory/dashboard/'),
  getCategories: (params?: Record<string, unknown>) => api.get('/api/inventory/categories/', { params }),
  createCategory: (data: object) => api.post('/api/inventory/categories/', data),
  getVendors: (params?: Record<string, unknown>) => api.get('/api/inventory/vendors/', { params }),
  createVendor: (data: object) => api.post('/api/inventory/vendors/', data),
  getItems: (params?: Record<string, unknown>) => api.get('/api/inventory/items/', { params }),
  createItem: (data: object) => api.post('/api/inventory/items/', data),
  updateItem: (id: number, data: object) => api.patch(`/api/inventory/items/${id}/`, data),
  getAssignments: (params?: Record<string, unknown>) => api.get('/api/inventory/assignments/', { params }),
  createAssignment: (data: object) => api.post('/api/inventory/assignments/', data),
  returnItem: (id: number, data: object) => api.post(`/api/inventory/assignments/${id}/return/`, data),
  getTransactions: (params?: Record<string, unknown>) => api.get('/api/inventory/transactions/', { params }),
  createTransaction: (data: object) => api.post('/api/inventory/transactions/', data),
  getReorderPrediction: (params?: Record<string, unknown>) => api.get('/api/inventory/reorder-prediction/', { params }),
};

// ─── Admissions API ──────────────────────────────────────────────────────────
// Admin and principal only (the web route guard; the server refuses writes to anyone else).

export const admissionsApi = {
  getEnquiries: (params?: Record<string, unknown>) => api.get('/api/admissions/enquiries/', { params }),
  getStatusCounts: () => api.get('/api/admissions/enquiries/status-counts/'),
  getEnquiry: (id: number) => api.get(`/api/admissions/enquiries/${id}/`),
  createEnquiry: (data: object) => api.post('/api/admissions/enquiries/', data),
  updateEnquiry: (id: number, data: object) => api.patch(`/api/admissions/enquiries/${id}/`, data),
  deleteEnquiry: (id: number) => api.delete(`/api/admissions/enquiries/${id}/`),
  updateStatus: (id: number, data: { status: string; note?: string }) =>
    api.patch(`/api/admissions/enquiries/${id}/update-status/`, data),
  batchConvert: (data: object) => api.post('/api/admissions/enquiries/batch-convert/', data),
  addNote: (enquiryId: number, data: object) => api.post(`/api/admissions/enquiries/${enquiryId}/notes/`, data),
  getFollowups: (type: 'today' | 'overdue') => api.get(`/api/admissions/followups/${type}/`),
  getConversionLikelihood: () => api.get('/api/admissions/conversion-likelihood/'),
};

// ─── School profile (admin and principal) ────────────────────────────────────

export const schoolsApi = {
  getMySchool: () => api.get('/api/schools/current/'),
  uploadAsset: (form: FormData) => api.post('/api/schools/upload_asset/', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }),
  deleteAsset: (assetType: string) => api.delete('/api/schools/delete_asset/', { params: { asset_type: assetType } }),
  updateTimeZone: (timezone: string) => api.put('/api/schools/time_zone/', { timezone }),
  updateExamConfig: (data: object) => api.put('/api/schools/exam_config/', data),
  updateAttendanceConfig: (data: object) => api.put('/api/schools/attendance_config/', data),
};

export const usersApi = {
  getUsers: (params?: Record<string, unknown>) => api.get('/api/users/', { params }),
  // Users and roles of the school (admin and principal): the server refuses roles above the caller's.
  createUser: (data: object) => api.post('/api/users/', data),
  updateUser: (id: number, data: object) => api.patch(`/api/users/${id}/`, data),
  resetPassword: (id: number, data: object) => api.post(`/api/users/${id}/reset_password/`, data),
};

// ─── Academics API ───────────────────────────────────────────────────────────

export const academicsApi = {
  getClassSubjects: (params?: Record<string, unknown>) =>
    api.get('/api/academics/class-subjects/', { params }),
  getSubjects: (params?: Record<string, unknown>) =>
    api.get('/api/academics/subjects/', { params }),
  // Subjects, class subjects, class teachers and timetable editing (admin and principal write).
  createSubject: (data: object) => api.post('/api/academics/subjects/', data),
  updateSubject: (id: number, data: object) => api.patch(`/api/academics/subjects/${id}/`, data),
  deleteSubject: (id: number) => api.delete(`/api/academics/subjects/${id}/`),
  createClassSubject: (data: object) => api.post('/api/academics/class-subjects/', data),
  updateClassSubject: (id: number, data: object) => api.patch(`/api/academics/class-subjects/${id}/`, data),
  deleteClassSubject: (id: number) => api.delete(`/api/academics/class-subjects/${id}/`),
  getClassTeachers: (params?: Record<string, unknown>) => api.get('/api/academics/class-teachers/', { params }),
  createClassTeacher: (data: object) => api.post('/api/academics/class-teachers/', data),
  deleteClassTeacher: (id: number) => api.delete(`/api/academics/class-teachers/${id}/`),
  getTimetableSlots: (params?: Record<string, unknown>) => api.get('/api/academics/timetable-slots/', { params }),
  createTimetableSlot: (data: object) => api.post('/api/academics/timetable-slots/', data),
  updateTimetableSlot: (id: number, data: object) => api.patch(`/api/academics/timetable-slots/${id}/`, data),
  deleteTimetableSlot: (id: number) => api.delete(`/api/academics/timetable-slots/${id}/`),
  // Replaces one class day (or one section's override of it) with the entries sent.
  bulkSaveTimetable: (data: object) => api.post('/api/academics/timetable-entries/bulk_save/', data),
  // Drops a section's override of one day so it follows the shared timetable again.
  clearSectionTimetableDay: (data: { session_class: number; day: string }) => api.post('/api/academics/timetable-entries/clear_section_day/', data),
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
  createExamType: (data: object) => api.post('/api/examinations/exam-types/', data),
  updateExamType: (id: number, data: object) => api.patch(`/api/examinations/exam-types/${id}/`, data),
  deleteExamType: (id: number) => api.delete(`/api/examinations/exam-types/${id}/`),
  getGradeScales: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/grade-scales/', { params }),
  createGradeScale: (data: object) => api.post('/api/examinations/grade-scales/', data),
  updateGradeScale: (id: number, data: object) => api.patch(`/api/examinations/grade-scales/${id}/`, data),
  deleteGradeScale: (id: number) => api.delete(`/api/examinations/grade-scales/${id}/`),
  getExamSubjects: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/exam-subjects/', { params }),
  getMarks: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/marks/', { params }),
  // 200 even when it skips rows it rejects: check `errors` in the body.
  bulkEntryMarks: (data: Record<string, unknown>) =>
    api.post('/api/examinations/marks/bulk_entry/', data),
  getExams: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/exams/', { params }),
  // Exam groups: the date sheet and publishing (admin and principal).
  getExamGroups: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/exam-groups/', { params }),
  getDateSheet: (groupId: number) => api.get(`/api/examinations/exam-groups/${groupId}/date-sheet/`),
  updateDateSheet: (groupId: number, entries: object[]) =>
    api.patch(`/api/examinations/exam-groups/${groupId}/date-sheet/`, { date_sheet: entries }),
  updateDateBySubject: (groupId: number, data: { subject_id: number; exam_date: string | null }) =>
    api.post(`/api/examinations/exam-groups/${groupId}/update-date-by-subject/`, data),
  publishScheduleAll: (groupId: number) => api.post(`/api/examinations/exam-groups/${groupId}/publish-schedule-all/`),
  unpublishScheduleAll: (groupId: number) => api.post(`/api/examinations/exam-groups/${groupId}/unpublish-schedule-all/`),
  announceResultsAll: (groupId: number) => api.post(`/api/examinations/exam-groups/${groupId}/announce-results-all/`),
  unpublishResultsAll: (groupId: number) => api.post(`/api/examinations/exam-groups/${groupId}/unpublish-results-all/`),
  publishExamSchedule: (id: number) => api.post(`/api/examinations/exams/${id}/publish-schedule/`),
  unpublishExamSchedule: (id: number) => api.post(`/api/examinations/exams/${id}/unpublish-schedule/`),
  announceExamResults: (id: number) => api.post(`/api/examinations/exams/${id}/announce-results/`),
  unpublishExamResults: (id: number) => api.post(`/api/examinations/exams/${id}/unpublish-results/`),
  // Exam creation (admin and principal): one exam per whole class; the date sheet wizard stays on the web.
  // Several classes at once with their date sheet, in one transaction (409 lists classes that already have it).
  wizardCreateExamGroup: (data: object) => api.post('/api/examinations/exam-groups/wizard-create/', data),
  createExam: (data: object) => api.post('/api/examinations/exams/', data),
  updateExam: (id: number, data: object) => api.patch(`/api/examinations/exams/${id}/`, data),
  deleteExam: (id: number) => api.delete(`/api/examinations/exams/${id}/`),
  populateExamSubjects: (id: number) => api.post(`/api/examinations/exams/${id}/populate-subjects/`),
  getQuestions: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/questions/', { params }),
  createQuestion: (data: object) => api.post('/api/examinations/questions/', data),
  updateQuestion: (id: number, data: object) => api.patch(`/api/examinations/questions/${id}/`, data),
  deleteQuestion: (id: number) => api.delete(`/api/examinations/questions/${id}/`),
  // Pictures on a saved question: slot is question, option_a to option_d, or answer (JPEG/PNG/WebP, 5 MB).
  uploadQuestionPicture: (id: number, form: FormData) =>
    api.post(`/api/examinations/questions/${id}/diagram/`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }),
  removeQuestionPicture: (id: number, slot: string) => api.post(`/api/examinations/questions/${id}/remove_diagram/`, { slot }),
  getExamPapers: (params?: Record<string, unknown>) =>
    api.get('/api/examinations/exam-papers/', { params }),
  getExamPaper: (id: number) => api.get(`/api/examinations/exam-papers/${id}/`),
  createExamPaper: (data: object) => api.post('/api/examinations/exam-papers/', data),
  updateExamPaper: (id: number, data: object) => api.patch(`/api/examinations/exam-papers/${id}/`, data),
  deleteExamPaper: (id: number) => api.delete(`/api/examinations/exam-papers/${id}/`),
  // Draft flow the web uses, so sections survive: ensure-draft creates the paper, autosave stores details,
  // structure and the questions in order (draft papers only).
  ensurePaperDraft: (data: object) => api.post('/api/examinations/exam-papers/ensure-draft/', data),
  autosavePaperDraft: (id: number, data: object) => api.post(`/api/examinations/exam-papers/${id}/autosave/`, data),
  generatePaperPdf: (id: number) => api.get(`/api/examinations/exam-papers/${id}/generate-pdf/`, { responseType: 'arraybuffer' }),
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
