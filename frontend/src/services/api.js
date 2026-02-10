import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || ''

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor - add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
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

// Users API
export const usersApi = {
  getUsers: (params) => api.get('/api/users/', { params }),
  getUser: (id) => api.get(`/api/users/${id}/`),
  createUser: (data) => api.post('/api/users/', data),
  updateUser: (id, data) => api.patch(`/api/users/${id}/`, data),
  deleteUser: (id) => api.delete(`/api/users/${id}/`),
}
