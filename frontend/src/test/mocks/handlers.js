import { http, HttpResponse } from 'msw'

// Default mock data
const mockCategories = [
  { id: 1, school: 1, name: 'Science', description: 'Science books' },
  { id: 2, school: 1, name: 'Fiction', description: 'Fiction books' },
]

const mockDiscounts = [
  {
    id: 1, school: 1, name: 'Early Bird', discount_type: 'PERCENTAGE',
    value: 10, applies_to: 'ALL', is_active: true, stackable: false,
  },
  {
    id: 2, school: 1, name: 'Scholarship', discount_type: 'FIXED',
    value: 500, applies_to: 'ALL', is_active: true, stackable: false,
  },
]

const mockRoutes = [
  {
    id: 1, name: 'Route North', start_location: 'School Gate',
    end_location: 'North Colony', distance_km: 12.5,
    estimated_duration_minutes: 45, is_active: true,
  },
]

const mockStops = [
  { id: 1, route: 1, name: 'Stop A', address: '123 Main St', stop_order: 1, pickup_time: '07:30', drop_time: '14:30' },
  { id: 2, route: 1, name: 'Stop B', address: '456 Oak Ave', stop_order: 2, pickup_time: '07:40', drop_time: '14:20' },
]

const mockLeaveApplications = [
  {
    id: 1, staff_member: 1, staff_member_name: 'Ali Khan',
    leave_policy: 1, leave_policy_name: 'Annual Leave',
    start_date: '2026-03-01', end_date: '2026-03-05',
    status: 'PENDING', reason: 'Vacation',
  },
]

const mockLeavePolicies = [
  { id: 1, name: 'Annual Leave', leave_type: 'ANNUAL', days_allowed: 20 },
]

const mockStaffAttendanceSummary = {
  total_records: 20, present: 15, absent: 3, late: 2,
  present_percentage: 75.0,
}

const mockTransportAssignments = [
  { id: 1, student: 1, student_name: 'Ali Hassan', route: 1, transport_type: 'BOTH' },
  { id: 2, student: 2, student_name: 'Sara Khan', route: 1, transport_type: 'BOTH' },
]

const mockTransportAttendance = [
  { id: 1, student: 1, route: 1, date: '2026-02-10', boarding_status: 'BOARDED' },
  { id: 2, student: 2, route: 1, date: '2026-02-10', boarding_status: 'NOT_BOARDED' },
]

// Students with user account status
const mockStudentsWithAccounts = [
  {
    id: 1, school: 1, school_name: 'Test School', class_obj: 1, class_name: 'Class 1A',
    roll_number: '1', name: 'Ali Hassan', parent_phone: '0300-1111111', parent_name: 'Hassan Sr',
    is_active: true, status: 'ACTIVE', has_user_account: true, user_username: 'ali_hassan',
    created_at: '2025-01-01', updated_at: '2025-01-01',
  },
  {
    id: 2, school: 1, school_name: 'Test School', class_obj: 1, class_name: 'Class 1A',
    roll_number: '2', name: 'Sara Khan', parent_phone: '0300-2222222', parent_name: 'Khan Sr',
    is_active: true, status: 'ACTIVE', has_user_account: false, user_username: null,
    created_at: '2025-01-01', updated_at: '2025-01-01',
  },
  {
    id: 3, school: 1, school_name: 'Test School', class_obj: 1, class_name: 'Class 1A',
    roll_number: '3', name: 'Usman Ahmed', parent_phone: '0300-3333333', parent_name: 'Ahmed Sr',
    is_active: true, status: 'ACTIVE', has_user_account: false, user_username: null,
    created_at: '2025-01-01', updated_at: '2025-01-01',
  },
]

// Staff with user account status
const mockStaffWithAccounts = [
  {
    id: 1, school: 1, first_name: 'Ali', last_name: 'Khan', employee_id: 'T001',
    department: 1, department_name: 'Academic', designation: 1, designation_name: 'Teacher',
    employment_status: 'ACTIVE', employment_type: 'FULL_TIME', phone: '0300-1111111',
    user: 10, user_username: 'ali_khan',
    date_of_joining: '2024-01-01',
  },
  {
    id: 2, school: 1, first_name: 'Sara', last_name: 'Ahmed', employee_id: 'T002',
    department: 1, department_name: 'Academic', designation: 1, designation_name: 'Teacher',
    employment_status: 'ACTIVE', employment_type: 'FULL_TIME', phone: '0300-2222222',
    user: null, user_username: null,
    date_of_joining: '2024-01-01',
  },
  {
    id: 3, school: 1, first_name: 'Jane', last_name: 'Doe', employee_id: 'EMP001',
    department: 1, department_name: 'Academic', designation: 1, designation_name: 'Teacher',
    employment_status: 'ACTIVE', employment_type: 'FULL_TIME', phone: '0300-3333333',
    user: null, user_username: null,
    date_of_joining: '2024-06-01',
  },
]

export const handlers = [
  // Auth
  http.get('/api/auth/me/', () =>
    HttpResponse.json({ id: 1, username: 'admin', role: 'SCHOOL_ADMIN', schools: [{ id: 1, name: 'Test School', role: 'SCHOOL_ADMIN', is_default: true }] })
  ),

  // Library categories
  http.get('/api/library/categories/', () =>
    HttpResponse.json(mockCategories)
  ),
  http.post('/api/library/categories/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 3, school: 1, ...body }, { status: 201 })
  }),
  http.patch('/api/library/categories/:id/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 1, school: 1, name: 'Updated', ...body })
  }),
  http.delete('/api/library/categories/:id/', () =>
    new HttpResponse(null, { status: 204 })
  ),

  // Library books
  http.get('/api/library/books/', () => HttpResponse.json([])),

  // Finance discounts
  http.get('/api/finance/discounts/', () =>
    HttpResponse.json(mockDiscounts)
  ),
  http.post('/api/finance/discounts/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 3, school: 1, ...body }, { status: 201 })
  }),
  http.patch('/api/finance/discounts/:id/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 1, school: 1, ...body })
  }),
  http.delete('/api/finance/discounts/:id/', () =>
    new HttpResponse(null, { status: 204 })
  ),

  // Finance scholarships & student discounts
  http.get('/api/finance/scholarships/', () => HttpResponse.json([])),
  http.get('/api/finance/student-discounts/', () => HttpResponse.json([])),

  // Transport routes
  http.get('/api/transport/routes/', () =>
    HttpResponse.json(mockRoutes)
  ),
  http.post('/api/transport/routes/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 2, ...body }, { status: 201 })
  }),
  http.delete('/api/transport/routes/:id/', () =>
    new HttpResponse(null, { status: 204 })
  ),

  // Transport stops
  http.get('/api/transport/stops/', ({ request }) => {
    const url = new URL(request.url)
    const routeId = url.searchParams.get('route_id')
    if (routeId) {
      return HttpResponse.json(mockStops.filter(s => s.route === parseInt(routeId)))
    }
    return HttpResponse.json(mockStops)
  }),
  http.post('/api/transport/stops/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 3, ...body }, { status: 201 })
  }),
  http.patch('/api/transport/stops/:id/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 1, ...body })
  }),
  http.delete('/api/transport/stops/:id/', () =>
    new HttpResponse(null, { status: 204 })
  ),

  // Transport vehicles
  http.get('/api/transport/vehicles/', () => HttpResponse.json([])),

  // Transport assignments
  http.get('/api/transport/assignments/', () =>
    HttpResponse.json(mockTransportAssignments)
  ),

  // Transport attendance
  http.get('/api/transport/attendance/', () =>
    HttpResponse.json(mockTransportAttendance)
  ),
  http.post('/api/transport/attendance/bulk_mark/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ detail: 'Attendance marked', ...body })
  }),

  // HR attendance
  http.get('/api/hr/attendance/', () => HttpResponse.json([])),
  http.get('/api/hr/attendance/summary/', ({ request }) => {
    const url = new URL(request.url)
    const dateFrom = url.searchParams.get('date_from')
    const dateTo = url.searchParams.get('date_to')
    if (!dateFrom || !dateTo) {
      return HttpResponse.json({ detail: 'date_from and date_to are required.' }, { status: 400 })
    }
    return HttpResponse.json(mockStaffAttendanceSummary)
  }),

  // HR staff
  http.get('/api/hr/staff/', () => HttpResponse.json(mockStaffWithAccounts)),
  http.get('/api/hr/dashboard/', () => HttpResponse.json({ total_staff: 3 })),
  http.post('/api/hr/staff/:id/create-user-account/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({
      message: 'User account created successfully.',
      user_id: 99,
      username: body.username,
    }, { status: 201 })
  }),
  http.post('/api/hr/staff/bulk-create-accounts/', async ({ request }) => {
    const body = await request.json()
    const staffIds = body.staff_ids || []
    return HttpResponse.json({
      created_count: staffIds.length,
      skipped_count: 0,
      error_count: 0,
      created: staffIds.map((id, i) => ({ staff_id: id, username: `staff_${id}`, name: `Staff ${i + 1}` })),
      skipped: [],
      errors: [],
    })
  }),

  // HR leave
  http.get('/api/hr/leave-policies/', () =>
    HttpResponse.json(mockLeavePolicies)
  ),
  http.post('/api/hr/leave-policies/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 2, ...body }, { status: 201 })
  }),
  http.patch('/api/hr/leave-policies/:id/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 1, ...body })
  }),
  http.delete('/api/hr/leave-policies/:id/', () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.get('/api/hr/leave-applications/', () =>
    HttpResponse.json(mockLeaveApplications)
  ),
  http.post('/api/hr/leave-applications/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 2, status: 'PENDING', ...body }, { status: 201 })
  }),
  http.post('/api/hr/leave-applications/:id/approve/', () =>
    HttpResponse.json({ id: 1, status: 'APPROVED' })
  ),
  http.post('/api/hr/leave-applications/:id/reject/', () =>
    HttpResponse.json({ id: 1, status: 'REJECTED' })
  ),
  http.post('/api/hr/leave-applications/:id/cancel/', () =>
    HttpResponse.json({ id: 1, status: 'CANCELLED' })
  ),
  http.get('/api/hr/leave-applications/leave_balance/', () =>
    HttpResponse.json([])
  ),

  // Sessions
  http.get('/api/sessions/years/', () => HttpResponse.json([])),
  http.get('/api/sessions/terms/', () => HttpResponse.json([])),

  // Classes & Students
  http.get('/api/students/classes/', () => HttpResponse.json([
    { id: 1, school: 1, school_name: 'Test School', name: 'Class 1A', section: 'A', grade_level: 1, is_active: true, student_count: 3 },
  ])),
  http.get('/api/students/', () => HttpResponse.json(mockStudentsWithAccounts)),
  http.post('/api/students/:id/create-user-account/', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({
      message: 'User account created successfully.',
      user_id: 88,
      username: body.username,
    }, { status: 201 })
  }),
  http.post('/api/students/bulk-create-accounts/', async ({ request }) => {
    const body = await request.json()
    const studentIds = body.student_ids || []
    return HttpResponse.json({
      created_count: studentIds.length,
      skipped_count: 0,
      error_count: 0,
      created: studentIds.map((id, i) => ({ student_id: id, username: `student_${id}`, student_name: `Student ${i + 1}` })),
      skipped: [],
      errors: [],
    })
  }),

  // Schools (for super admin)
  http.get('/api/schools/admin/', () => HttpResponse.json([])),

  // HR departments & designations
  http.get('/api/hr/departments/', () => HttpResponse.json([
    { id: 1, school: 1, name: 'Academic' },
  ])),
  http.get('/api/hr/designations/', () => HttpResponse.json([
    { id: 1, school: 1, name: 'Teacher', department: 1 },
  ])),
]
