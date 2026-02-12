import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || ''

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor - add auth token + active school header
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    const schoolId = localStorage.getItem('active_school_id')
    if (schoolId) {
      config.headers['X-School-ID'] = schoolId
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor - handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // If 401 and we haven't already retried
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      const refreshToken = localStorage.getItem('refresh_token')

      if (refreshToken) {
        try {
          const response = await axios.post(`${API_URL}/api/auth/refresh/`, {
            refresh: refreshToken,
          })

          const { access } = response.data
          localStorage.setItem('access_token', access)

          // Retry original request with new token
          originalRequest.headers.Authorization = `Bearer ${access}`
          return api(originalRequest)
        } catch (refreshError) {
          // Refresh failed - clear tokens and redirect to login
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          window.location.href = '/login'
          return Promise.reject(refreshError)
        }
      }
    }

    return Promise.reject(error)
  }
)

export default api

// Attendance API
export const attendanceApi = {
  // Upload image to storage and get URL
  uploadImageToStorage: (file, schoolId, classId) => {
    const formData = new FormData()
    formData.append('image', file)
    formData.append('school_id', schoolId)
    formData.append('class_id', classId)
    return api.post('/api/attendance/upload-image/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  // Create attendance upload record
  createUpload: (data) => api.post('/api/attendance/uploads/', data),

  // Legacy - kept for compatibility
  uploadImage: (data) => api.post('/api/attendance/uploads/', data),

  // Get uploads list
  getUploads: (params) => api.get('/api/attendance/uploads/', { params }),

  // Get upload details
  getUploadDetails: (id) => api.get(`/api/attendance/uploads/${id}/`),

  // Confirm attendance with optional name/roll corrections
  confirmAttendance: (id, { absentStudentIds, nameCorrections = [], rollCorrections = [] }) =>
    api.post(`/api/attendance/uploads/${id}/confirm/`, {
      absent_student_ids: absentStudentIds,
      name_corrections: nameCorrections,
      roll_corrections: rollCorrections,
    }),

  // Get pending reviews
  getPendingReviews: () => api.get('/api/attendance/uploads/pending_review/'),

  // Get attendance records
  getRecords: (params) => api.get('/api/attendance/records/', { params }),

  // Get daily report
  getDailyReport: (date, schoolId) =>
    api.get('/api/attendance/records/daily_report/', {
      params: { date, school_id: schoolId },
    }),

  // Get chronic absentees
  getChronicAbsentees: (params) =>
    api.get('/api/attendance/records/chronic_absentees/', { params }),

  // Reprocess AI for an upload
  reprocessUpload: (id) => api.post(`/api/attendance/uploads/${id}/reprocess/`),

  // Delete an upload (only non-confirmed)
  deleteUpload: (id) => api.delete(`/api/attendance/uploads/${id}/`),

  // Test if image URL is accessible
  testImageUrl: (id) => api.get(`/api/attendance/uploads/${id}/test_image/`),

  // Learning metrics
  getAccuracyStats: (params) => api.get('/api/attendance/records/accuracy_stats/', { params }),
  getMappingSuggestions: (params) => api.get('/api/attendance/records/mapping_suggestions/', { params }),

  // AI Status
  getAIStatus: () => api.get('/api/attendance/ai-status/'),
}

// Schools API
export const schoolsApi = {
  // Super Admin endpoints
  getAllSchools: (params) => api.get('/api/admin/schools/', { params }),
  getAdminSchools: (params) => api.get('/api/admin/schools/', { params }),
  createSchool: (data) => api.post('/api/admin/schools/', data),
  updateSchool: (id, data) => api.patch(`/api/admin/schools/${id}/`, data),
  getSchoolStats: (id) => api.get(`/api/admin/schools/${id}/stats/`),
  getPlatformStats: () => api.get('/api/admin/schools/platform_stats/'),
  activateSchool: (id) => api.post(`/api/admin/schools/${id}/activate/`),
  deactivateSchool: (id) => api.post(`/api/admin/schools/${id}/deactivate/`),

  // Regular endpoints
  getMySchool: () => api.get('/api/schools/current/'),

  // Mark mappings configuration
  getMarkMappings: () => api.get('/api/schools/mark_mappings/'),
  updateMarkMappings: (data) => api.put('/api/schools/mark_mappings/', data),

  // Register configuration
  getRegisterConfig: () => api.get('/api/schools/register_config/'),
  updateRegisterConfig: (data) => api.put('/api/schools/register_config/', data),
}

// Students API
export const studentsApi = {
  getStudents: (params) => api.get('/api/students/', { params }),
  getStudent: (id) => api.get(`/api/students/${id}/`),
  createStudent: (data) => api.post('/api/students/', data),
  updateStudent: (id, data) => api.patch(`/api/students/${id}/`, data),
  deleteStudent: (id) => api.delete(`/api/students/${id}/`),
  bulkCreateStudents: (data) => api.post('/api/students/bulk_create/', data),
  getStudentsByClass: (params) => api.get('/api/students/by_class/', { params }),
}

// Classes API
export const classesApi = {
  getClasses: (params) => api.get('/api/classes/', { params }),
  getClass: (id) => api.get(`/api/classes/${id}/`),
  createClass: (data) => api.post('/api/classes/', data),
  updateClass: (id, data) => api.patch(`/api/classes/${id}/`, data),
  deleteClass: (id) => api.delete(`/api/classes/${id}/`),
}

// Finance API
export const financeApi = {
  // Fee Structures
  getFeeStructures: (params) => api.get('/api/finance/fee-structures/', { params }),
  createFeeStructure: (data) => api.post('/api/finance/fee-structures/', data),
  updateFeeStructure: (id, data) => api.patch(`/api/finance/fee-structures/${id}/`, data),
  deleteFeeStructure: (id) => api.delete(`/api/finance/fee-structures/${id}/`),
  bulkSetFeeStructures: (data) => api.post('/api/finance/fee-structures/bulk_set/', data),

  // Fee Payments
  getFeePayments: (params) => api.get('/api/finance/fee-payments/', { params }),
  recordPayment: (id, data) => api.patch(`/api/finance/fee-payments/${id}/`, data),
  createPayment: (data) => api.post('/api/finance/fee-payments/', data),
  generateMonthly: (data) => api.post('/api/finance/fee-payments/generate_monthly/', data),
  getMonthlySummary: (params) => api.get('/api/finance/fee-payments/monthly_summary/', { params }),
  getMonthlySummaryAll: (params) => api.get('/api/finance/fee-payments/monthly_summary_all/', { params }),
  getStudentLedger: (params) => api.get('/api/finance/fee-payments/student_ledger/', { params }),
  deleteFeePayment: (id) => api.delete(`/api/finance/fee-payments/${id}/`),
  bulkUpdatePayments: (data) => api.post('/api/finance/fee-payments/bulk_update/', data),
  bulkDeletePayments: (data) => api.post('/api/finance/fee-payments/bulk_delete/', data),

  // Other Income
  getOtherIncome: (params) => api.get('/api/finance/other-income/', { params }),
  createOtherIncome: (data) => api.post('/api/finance/other-income/', data),
  updateOtherIncome: (id, data) => api.patch(`/api/finance/other-income/${id}/`, data),
  deleteOtherIncome: (id) => api.delete(`/api/finance/other-income/${id}/`),

  // Accounts
  getAccounts: (params) => api.get('/api/finance/accounts/', { params }),
  createAccount: (data) => api.post('/api/finance/accounts/', data),
  updateAccount: (id, data) => api.patch(`/api/finance/accounts/${id}/`, data),
  deleteAccount: (id) => api.delete(`/api/finance/accounts/${id}/`),
  getAccountBalances: (params) => api.get('/api/finance/accounts/balances/', { params }),
  getAccountBalancesAll: (params) => api.get('/api/finance/accounts/balances_all/', { params }),

  // Monthly Closings
  closeMonth: (data) => api.post('/api/finance/accounts/close_month/', data),
  getClosings: () => api.get('/api/finance/accounts/closings/'),
  reopenMonth: (id) => api.delete(`/api/finance/accounts/${id}/reopen/`),

  // Transfers
  getTransfers: (params) => api.get('/api/finance/transfers/', { params }),
  createTransfer: (data) => api.post('/api/finance/transfers/', data),
  deleteTransfer: (id) => api.delete(`/api/finance/transfers/${id}/`),

  // Expenses
  getExpenses: (params) => api.get('/api/finance/expenses/', { params }),
  createExpense: (data) => api.post('/api/finance/expenses/', data),
  updateExpense: (id, data) => api.patch(`/api/finance/expenses/${id}/`, data),
  deleteExpense: (id) => api.delete(`/api/finance/expenses/${id}/`),
  getExpenseCategorySummary: (params) => api.get('/api/finance/expenses/category_summary/', { params }),

  // Reports
  getFinanceSummary: (params) => api.get('/api/finance/reports/', { params }),
  getMonthlyTrend: (params) => api.get('/api/finance/reports/', { params: { ...params, type: 'monthly_trend' } }),

  // AI Chat
  sendChatMessage: (data) => api.post('/api/finance/ai-chat/', data),
  getChatHistory: () => api.get('/api/finance/ai-chat/'),
  clearChatHistory: () => api.delete('/api/finance/ai-chat/'),
}

// HR & Staff Management API
export const hrApi = {
  // Dashboard
  getDashboardStats: () => api.get('/api/hr/staff/dashboard_stats/'),

  // Staff Members
  getStaff: (params) => api.get('/api/hr/staff/', { params }),
  getStaffMember: (id) => api.get(`/api/hr/staff/${id}/`),
  createStaff: (data) => api.post('/api/hr/staff/', data),
  updateStaff: (id, data) => api.patch(`/api/hr/staff/${id}/`, data),
  deleteStaff: (id) => api.delete(`/api/hr/staff/${id}/`),

  // Departments
  getDepartments: (params) => api.get('/api/hr/departments/', { params }),
  createDepartment: (data) => api.post('/api/hr/departments/', data),
  updateDepartment: (id, data) => api.patch(`/api/hr/departments/${id}/`, data),
  deleteDepartment: (id) => api.delete(`/api/hr/departments/${id}/`),

  // Designations
  getDesignations: (params) => api.get('/api/hr/designations/', { params }),
  createDesignation: (data) => api.post('/api/hr/designations/', data),
  updateDesignation: (id, data) => api.patch(`/api/hr/designations/${id}/`, data),
  deleteDesignation: (id) => api.delete(`/api/hr/designations/${id}/`),

  // Salary Structures
  getSalaryStructures: (params) => api.get('/api/hr/salary-structures/', { params }),
  getSalaryStructure: (id) => api.get(`/api/hr/salary-structures/${id}/`),
  createSalaryStructure: (data) => api.post('/api/hr/salary-structures/', data),
  updateSalaryStructure: (id, data) => api.patch(`/api/hr/salary-structures/${id}/`, data),
  deleteSalaryStructure: (id) => api.delete(`/api/hr/salary-structures/${id}/`),
  getCurrentSalary: (staffMemberId) => api.get('/api/hr/salary-structures/current/', { params: { staff_member: staffMemberId } }),

  // Payslips / Payroll
  getPayslips: (params) => api.get('/api/hr/payslips/', { params }),
  getPayslip: (id) => api.get(`/api/hr/payslips/${id}/`),
  generatePayslips: (data) => api.post('/api/hr/payslips/generate_payslips/', data),
  approvePayslip: (id) => api.post(`/api/hr/payslips/${id}/approve/`),
  markPayslipPaid: (id, data) => api.post(`/api/hr/payslips/${id}/mark_paid/`, data),
  getPayrollSummary: (params) => api.get('/api/hr/payslips/payroll_summary/', { params }),

  // Leave Policies
  getLeavePolicies: (params) => api.get('/api/hr/leave-policies/', { params }),
  createLeavePolicy: (data) => api.post('/api/hr/leave-policies/', data),
  updateLeavePolicy: (id, data) => api.patch(`/api/hr/leave-policies/${id}/`, data),
  deleteLeavePolicy: (id) => api.delete(`/api/hr/leave-policies/${id}/`),

  // Leave Applications
  getLeaveApplications: (params) => api.get('/api/hr/leave-applications/', { params }),
  createLeaveApplication: (data) => api.post('/api/hr/leave-applications/', data),
  approveLeave: (id, data) => api.post(`/api/hr/leave-applications/${id}/approve/`, data),
  rejectLeave: (id, data) => api.post(`/api/hr/leave-applications/${id}/reject/`, data),
  cancelLeave: (id) => api.post(`/api/hr/leave-applications/${id}/cancel/`),
  getLeaveBalance: (staffMemberId) => api.get('/api/hr/leave-applications/leave_balance/', { params: { staff_member: staffMemberId } }),

  // Staff Attendance
  getStaffAttendance: (params) => api.get('/api/hr/attendance/', { params }),
  createStaffAttendance: (data) => api.post('/api/hr/attendance/', data),
  updateStaffAttendance: (id, data) => api.patch(`/api/hr/attendance/${id}/`, data),
  bulkMarkAttendance: (data) => api.post('/api/hr/attendance/bulk_mark/', data),
  getAttendanceSummary: (params) => api.get('/api/hr/attendance/summary/', { params }),

  // Performance Appraisals
  getAppraisals: (params) => api.get('/api/hr/appraisals/', { params }),
  getAppraisal: (id) => api.get(`/api/hr/appraisals/${id}/`),
  createAppraisal: (data) => api.post('/api/hr/appraisals/', data),
  updateAppraisal: (id, data) => api.patch(`/api/hr/appraisals/${id}/`, data),
  deleteAppraisal: (id) => api.delete(`/api/hr/appraisals/${id}/`),

  // Staff Qualifications
  getQualifications: (params) => api.get('/api/hr/qualifications/', { params }),
  createQualification: (data) => api.post('/api/hr/qualifications/', data),
  updateQualification: (id, data) => api.patch(`/api/hr/qualifications/${id}/`, data),
  deleteQualification: (id) => api.delete(`/api/hr/qualifications/${id}/`),

  // Staff Documents
  getDocuments: (params) => api.get('/api/hr/documents/', { params }),
  createDocument: (data) => api.post('/api/hr/documents/', data),
  deleteDocument: (id) => api.delete(`/api/hr/documents/${id}/`),
}

// Academics (Subjects & Timetable) API
export const academicsApi = {
  // Subjects
  getSubjects: (params) => api.get('/api/academics/subjects/', { params }),
  getSubject: (id) => api.get(`/api/academics/subjects/${id}/`),
  createSubject: (data) => api.post('/api/academics/subjects/', data),
  updateSubject: (id, data) => api.patch(`/api/academics/subjects/${id}/`, data),
  deleteSubject: (id) => api.delete(`/api/academics/subjects/${id}/`),

  // Class-Subject Assignments
  getClassSubjects: (params) => api.get('/api/academics/class-subjects/', { params }),
  createClassSubject: (data) => api.post('/api/academics/class-subjects/', data),
  updateClassSubject: (id, data) => api.patch(`/api/academics/class-subjects/${id}/`, data),
  deleteClassSubject: (id) => api.delete(`/api/academics/class-subjects/${id}/`),
  getClassSubjectsByClass: (classId) =>
    api.get('/api/academics/class-subjects/by_class/', { params: { class_id: classId } }),

  // Timetable Slots
  getTimetableSlots: (params) => api.get('/api/academics/timetable-slots/', { params }),
  createTimetableSlot: (data) => api.post('/api/academics/timetable-slots/', data),
  updateTimetableSlot: (id, data) => api.patch(`/api/academics/timetable-slots/${id}/`, data),
  deleteTimetableSlot: (id) => api.delete(`/api/academics/timetable-slots/${id}/`),

  // Timetable Entries
  getTimetableEntries: (params) => api.get('/api/academics/timetable-entries/', { params }),
  getTimetableByClass: (classId) =>
    api.get('/api/academics/timetable-entries/by_class/', { params: { class_id: classId } }),
  bulkSaveTimetable: (data) => api.post('/api/academics/timetable-entries/bulk_save/', data),
  checkTeacherConflicts: (params) =>
    api.get('/api/academics/timetable-entries/teacher_conflicts/', { params }),

  // AI Features
  autoGenerateTimetable: (data) =>
    api.post('/api/academics/timetable-entries/auto_generate/', data),
  suggestConflictResolution: (params) =>
    api.get('/api/academics/timetable-entries/suggest_resolution/', { params }),
  getTimetableQualityScore: (classId) =>
    api.get('/api/academics/timetable-entries/quality_score/', { params: { class_id: classId } }),
  suggestSubstitute: (params) =>
    api.get('/api/academics/timetable-entries/suggest_substitute/', { params }),
  getWorkloadAnalysis: () =>
    api.get('/api/academics/class-subjects/workload_analysis/'),
  getGapAnalysis: () =>
    api.get('/api/academics/subjects/gap_analysis/'),
  getAnalytics: (params) =>
    api.get('/api/academics/analytics/', { params }),

  // AI Chat
  sendChatMessage: (data) => api.post('/api/academics/ai-chat/', data),
  getChatHistory: () => api.get('/api/academics/ai-chat/'),
  clearChatHistory: () => api.delete('/api/academics/ai-chat/'),
}

// Academic Sessions API
export const sessionsApi = {
  // Academic Years
  getAcademicYears: (params) => api.get('/api/sessions/academic-years/', { params }),
  getAcademicYear: (id) => api.get(`/api/sessions/academic-years/${id}/`),
  createAcademicYear: (data) => api.post('/api/sessions/academic-years/', data),
  updateAcademicYear: (id, data) => api.patch(`/api/sessions/academic-years/${id}/`, data),
  deleteAcademicYear: (id) => api.delete(`/api/sessions/academic-years/${id}/`),
  setCurrentYear: (id) => api.post(`/api/sessions/academic-years/${id}/set_current/`),
  getYearSummary: (id) => api.get(`/api/sessions/academic-years/${id}/summary/`),

  // Terms
  getTerms: (params) => api.get('/api/sessions/terms/', { params }),
  getTerm: (id) => api.get(`/api/sessions/terms/${id}/`),
  createTerm: (data) => api.post('/api/sessions/terms/', data),
  updateTerm: (id, data) => api.patch(`/api/sessions/terms/${id}/`, data),
  deleteTerm: (id) => api.delete(`/api/sessions/terms/${id}/`),

  // Enrollments
  getEnrollments: (params) => api.get('/api/sessions/enrollments/', { params }),
  createEnrollment: (data) => api.post('/api/sessions/enrollments/', data),
  updateEnrollment: (id, data) => api.patch(`/api/sessions/enrollments/${id}/`, data),
  deleteEnrollment: (id) => api.delete(`/api/sessions/enrollments/${id}/`),
  getEnrollmentsByClass: (params) => api.get('/api/sessions/enrollments/by_class/', { params }),
  bulkPromote: (data) => api.post('/api/sessions/enrollments/bulk_promote/', data),
}

// Grades API
export const gradesApi = {
  getGrades: (params) => api.get('/api/grades/', { params }),
  getGrade: (id) => api.get(`/api/grades/${id}/`),
  createGrade: (data) => api.post('/api/grades/', data),
  updateGrade: (id, data) => api.patch(`/api/grades/${id}/`, data),
  deleteGrade: (id) => api.delete(`/api/grades/${id}/`),
  getGradeClasses: (id) => api.get(`/api/grades/${id}/classes/`),
}

// Examinations API
export const examinationsApi = {
  // Exam Types
  getExamTypes: (params) => api.get('/api/examinations/exam-types/', { params }),
  createExamType: (data) => api.post('/api/examinations/exam-types/', data),
  updateExamType: (id, data) => api.patch(`/api/examinations/exam-types/${id}/`, data),
  deleteExamType: (id) => api.delete(`/api/examinations/exam-types/${id}/`),

  // Exams
  getExams: (params) => api.get('/api/examinations/exams/', { params }),
  getExam: (id) => api.get(`/api/examinations/exams/${id}/`),
  createExam: (data) => api.post('/api/examinations/exams/', data),
  updateExam: (id, data) => api.patch(`/api/examinations/exams/${id}/`, data),
  deleteExam: (id) => api.delete(`/api/examinations/exams/${id}/`),
  publishExam: (id) => api.post(`/api/examinations/exams/${id}/publish/`),
  getExamResults: (id) => api.get(`/api/examinations/exams/${id}/results/`),
  getClassSummary: (id) => api.get(`/api/examinations/exams/${id}/class_summary/`),

  // Exam Subjects
  getExamSubjects: (params) => api.get('/api/examinations/exam-subjects/', { params }),
  createExamSubject: (data) => api.post('/api/examinations/exam-subjects/', data),
  updateExamSubject: (id, data) => api.patch(`/api/examinations/exam-subjects/${id}/`, data),
  deleteExamSubject: (id) => api.delete(`/api/examinations/exam-subjects/${id}/`),

  // Marks
  getMarks: (params) => api.get('/api/examinations/marks/', { params }),
  createMark: (data) => api.post('/api/examinations/marks/', data),
  updateMark: (id, data) => api.patch(`/api/examinations/marks/${id}/`, data),
  bulkEntryMarks: (data) => api.post('/api/examinations/marks/bulk_entry/', data),
  getMarksByStudent: (params) => api.get('/api/examinations/marks/by_student/', { params }),

  // Grade Scales
  getGradeScales: (params) => api.get('/api/examinations/grade-scales/', { params }),
  createGradeScale: (data) => api.post('/api/examinations/grade-scales/', data),
  updateGradeScale: (id, data) => api.patch(`/api/examinations/grade-scales/${id}/`, data),
  deleteGradeScale: (id) => api.delete(`/api/examinations/grade-scales/${id}/`),

  // Report Card
  getReportCard: (params) => api.get('/api/examinations/report-card/', { params }),
}

// Auth API (school switching + profile)
export const authApi = {
  switchSchool: (schoolId) => api.post('/api/auth/switch-school/', { school_id: schoolId }),
  updateProfile: (data) => api.patch('/api/auth/me/', data),
  changePassword: (data) => api.post('/api/auth/change-password/', data),
}

// Organizations API (Super Admin)
export const organizationsApi = {
  getAll: (params) => api.get('/api/admin/organizations/', { params }),
  create: (data) => api.post('/api/admin/organizations/', data),
  update: (id, data) => api.patch(`/api/admin/organizations/${id}/`, data),
  delete: (id) => api.delete(`/api/admin/organizations/${id}/`),
}

// Memberships API (Super Admin)
export const membershipsApi = {
  getAll: (params) => api.get('/api/admin/memberships/', { params }),
  create: (data) => api.post('/api/admin/memberships/', data),
  update: (id, data) => api.patch(`/api/admin/memberships/${id}/`, data),
  delete: (id) => api.delete(`/api/admin/memberships/${id}/`),
}

// Users API
export const usersApi = {
  getUsers: (params) => api.get('/api/users/', { params }),
  getUser: (id) => api.get(`/api/users/${id}/`),
  createUser: (data) => api.post('/api/users/', data),
  updateUser: (id, data) => api.patch(`/api/users/${id}/`, data),
  deleteUser: (id) => api.delete(`/api/users/${id}/`),
}
