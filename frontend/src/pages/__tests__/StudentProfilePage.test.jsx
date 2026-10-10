import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Routes, Route } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/utils'
import StudentProfilePage from '../StudentProfilePage'

let mockRole = 'SCHOOL_ADMIN'
let mockYear = null

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: mockRole, username: 'admin' },
    activeSchool: { id: 1, name: 'Test School', role: mockRole, is_default: true },
    isModuleEnabled: () => true,
  }),
}))

vi.mock('../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: mockYear }),
}))

const mockShowSuccess = vi.fn()
const mockShowError = vi.fn()
vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showWarning: vi.fn(),
  }),
}))

const baseStudent = {
  id: 5,
  school: 1,
  school_name: 'Test School',
  class_obj: 1,
  class_name: 'Class 1A',
  roll_number: '9',
  name: 'Ali Hassan',
  gender: 'M',
  date_of_birth: '2015-04-02',
  blood_group: 'O+',
  parent_name: 'Hassan Sr',
  parent_phone: '+923001111111',
  guardian_email: 'g@example.com',
  status: 'ACTIVE',
  is_active: true,
  has_user_account: false,
}

// The mock server serves whatever `current` holds, and PATCH merges into it, so a
// save followed by the page's refetch shows the new values like the real API would.
let current
const patches = []

function useStudentApi(overrides = {}) {
  current = { ...baseStudent, ...overrides }
  patches.length = 0
  server.use(
    http.get('/api/students/5/', () => HttpResponse.json(current)),
    http.get('/api/students/5/profile_summary/', () => HttpResponse.json({})),
    http.get('/api/students/5/ai-profile/', () => HttpResponse.json({})),
    http.get('/api/student-exits/', () => HttpResponse.json({ count: 0, results: [] })),
    http.get('/api/student-exits/destinations/', () => HttpResponse.json([])),
    http.get('/api/students/5/removal-preview/', () => HttpResponse.json({
      has_history: true,
      counts: { attendance: 3, fees: 1, marks: 0, enrollments: 0, other: 0 },
      allowed_outcomes: ['WITHDRAWN', 'TRANSFERRED'].includes(current.status)
        ? ['READMIT', 'GRADUATED', 'REPEAT', 'REMOVE']
        : ['LEFT', 'TRANSFERRED', 'GRADUATED', 'REPEAT', 'REMOVE'],
      can_purge: false,
    })),
    http.patch('/api/students/5/', async ({ request }) => {
      const body = await request.json()
      patches.push(body)
      current = { ...current, ...body }
      return HttpResponse.json(current)
    }),
  )
}

async function renderProfile() {
  const user = userEvent.setup()
  renderWithProviders(
    <Routes>
      <Route path="/students/:id" element={<StudentProfilePage />} />
    </Routes>,
    { route: '/students/5' },
  )
  await screen.findByRole('heading', { name: 'Ali Hassan' })
  return user
}

const card = (title) => within(screen.getByRole('region', { name: title }))
const modalFor = (title) => within(screen.getByRole('heading', { name: title }).closest('.fixed'))

describe('StudentProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRole = 'SCHOOL_ADMIN'
    mockYear = null
    useStudentApi()
  })

  // ─── Reading ─────────────────────────────────────────────────

  it('shows the student details in one card per section, with "Not set" for blanks', async () => {
    await renderProfile()

    expect(card('Basic').getByText('Ali Hassan')).toBeInTheDocument()
    expect(card('Basic').getByText('Class 1A')).toBeInTheDocument()
    expect(card('Personal').getByText('Male')).toBeInTheDocument()
    expect(card('Personal').getByText('O+')).toBeInTheDocument()
    expect(card('Guardian').getByText('g@example.com')).toBeInTheDocument()
    expect(card('Guardian').getByText('Hassan Sr')).toBeInTheDocument()
    expect(card('Admission').getByText('Test School')).toBeInTheDocument()
    expect(card('Admission').getAllByText('Not set').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps a section editable even when it has no data yet', async () => {
    useStudentApi({ guardian_email: '', parent_name: '', parent_phone: '' })
    const user = await renderProfile()

    expect(card('Guardian').getAllByText('Not set').length).toBeGreaterThanOrEqual(5)
    await user.click(screen.getByRole('button', { name: 'Edit Guardian' }))
    expect(card('Guardian').getByLabelText('Guardian name')).toBeInTheDocument()
  })

  it('no longer has the all-fields "Edit Profile" button', async () => {
    await renderProfile()

    expect(screen.queryByRole('button', { name: 'Edit Profile' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Basic' })).toBeInTheDocument()
  })

  // ─── Header: pending fee and exit ────────────────────────────

  describe('header', () => {
    const waivedExit = {
      id: 70, status: 'FINALIZED', exit_type: 'WITHDRAWN', leaving_date: '2026-03-01', reason: 'Family relocated',
      destination_school_name: null,
      items: [
        { kind: 'FEES', kind_label: 'Pending fees', state: 'WAIVED', summary: 'PKR 1,500 pending',
          waiver_reason: 'Fee concession approved by the board', waived_by_name: 'principal', waived_at: '2026-03-02T10:00:00Z' },
        { kind: 'LIBRARY', kind_label: 'Library books', state: 'CLEAR', summary: '' },
      ],
    }

    const serveSummary = (summary) => server.use(
      http.get('/api/students/5/profile_summary/', () => HttpResponse.json(summary)),
    )

    it('shows the pending fee on the main card and jumps to the Fees tab', async () => {
      serveSummary({ pending_fee: 1500, latest_exit: null })
      const user = await renderProfile()

      const chip = await screen.findByRole('button', { name: 'Pending fee: PKR 1,500' })
      server.use(http.get('/api/students/5/fee_ledger/', () => HttpResponse.json([])))
      await user.click(chip)

      expect(screen.getByRole('button', { name: 'Fees' })).toHaveClass('border-primary-600')
    })

    it('keeps the cents on the pending fee', async () => {
      serveSummary({ pending_fee: 3847.5, latest_exit: null })
      await renderProfile()

      expect(await screen.findByRole('button', { name: 'Pending fee: PKR 3,847.50' })).toBeInTheDocument()
    })

    it('shows no fee chip when nothing is pending', async () => {
      serveSummary({ pending_fee: 0, latest_exit: null })
      await renderProfile()

      await waitFor(() => expect(screen.queryByText(/Pending fee:/)).not.toBeInTheDocument())
    })

    it('shows the exit banner with each waived item, who waived it and why', async () => {
      useStudentApi({ status: 'WITHDRAWN' })
      serveSummary({ pending_fee: 1500, latest_exit: waivedExit })
      await renderProfile()

      const banner = await screen.findByRole('status')
      expect(banner).toHaveTextContent('Withdrawn on')
      expect(banner).toHaveTextContent('Reason: Family relocated')
      expect(banner).toHaveTextContent('Pending fees waived (PKR 1,500 pending) by principal')
      expect(banner).toHaveTextContent('Fee concession approved by the board')
      expect(banner).not.toHaveTextContent('Library books')
    })

    it('names the destination for a transfer', async () => {
      useStudentApi({ status: 'TRANSFERRED' })
      serveSummary({ pending_fee: 0, latest_exit: { ...waivedExit, exit_type: 'TRANSFERRED', destination_school_name: 'Branch 2', items: [] } })
      await renderProfile()

      expect(await screen.findByRole('status')).toHaveTextContent('Transferred to Branch 2 on')
    })

    it('hides the banner once the student has been re-activated', async () => {
      serveSummary({ pending_fee: 0, latest_exit: waivedExit })  // student is ACTIVE again
      await renderProfile()

      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    })

    it('does not show a banner for an exit that is still open', async () => {
      serveSummary({ pending_fee: 0, latest_exit: { ...waivedExit, status: 'OPEN' } })
      await renderProfile()

      await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    })

    it('offers to continue an exit that is in progress, reopening the wizard at the checklist', async () => {
      const open = {
        id: 70, student: 5, status: 'OPEN', exit_type: 'WITHDRAWN', exit_type_label: 'Withdrawn (left school)',
        leaving_date: '2026-03-01', reason: '', remove_records_after_leaving: false, open_item_count: 0,
        items: [{ id: 1, kind: 'FEES', kind_label: 'Pending fees', state: 'CLEAR', summary: '', detail: {} }],
      }
      server.use(http.get('/api/student-exits/', () => HttpResponse.json({ count: 1, results: [open] })))
      const user = await renderProfile()

      await user.click(await screen.findByRole('button', { name: 'Exit in progress — Continue' }))

      expect(await screen.findByTestId('item-FEES')).toBeInTheDocument()
    })

    it('does not offer exit actions to a teacher', async () => {
      mockRole = 'TEACHER'
      const open = { id: 70, student: 5, status: 'OPEN', exit_type: 'WITHDRAWN', items: [] }
      server.use(http.get('/api/student-exits/', () => HttpResponse.json({ count: 1, results: [open] })))
      await renderProfile()

      expect(screen.queryByRole('button', { name: 'Exit in progress — Continue' })).not.toBeInTheDocument()
    })
  })

  // ─── Overview fee cards ──────────────────────────────────────

  describe('overview fee cards', () => {
    const serveSummary = (summary) => server.use(
      http.get('/api/students/5/profile_summary/', () => HttpResponse.json(summary)),
    )
    const card = async (label) => (await screen.findByText(label)).closest('div')

    it('shows paid, charged and owed from the shared figures (800 paid of 3,800 charged, 3,000 owed)', async () => {
      serveSummary({ total_due: 3800, total_paid: 800, outstanding: 3000, pending_fee: 3000, latest_exit: null })
      await renderProfile()

      const paid = await card('Fee Paid')
      expect(paid).toHaveTextContent('21%')
      expect(paid).toHaveTextContent('PKR 800 / 3,800')
      expect(await card('Outstanding')).toHaveTextContent('PKR 3,000')
    })

    it('keeps the cents on every fee figure', async () => {
      serveSummary({ total_due: 27360, total_paid: 23512.5, outstanding: 3847.5, pending_fee: 3847.5, latest_exit: null })
      await renderProfile()

      expect(await card('Fee Paid')).toHaveTextContent('PKR 23,512.50 / 27,360')
      expect(await card('Outstanding')).toHaveTextContent('PKR 3,847.50')
    })

    it('shows N/A and nothing owed for a student with no fees', async () => {
      serveSummary({ total_due: 0, total_paid: 0, outstanding: 0, pending_fee: 0, latest_exit: null })
      await renderProfile()

      expect(await card('Fee Paid')).toHaveTextContent('N/A')
      expect(await card('Outstanding')).toHaveTextContent('PKR 0')
    })
  })

  // ─── AI risk assessment ──────────────────────────────────────

  describe('risk assessment', () => {
    const serveAi = (ai) => server.use(
      http.get('/api/students/5/ai-profile/', () => HttpResponse.json(ai)),
    )
    const full = {
      left_school: false, overall_risk: 'MEDIUM', risk_score: 53.5, fees_hidden: false,
      attendance: { rate: 82, risk: 'LOW', trend: 'stable', insufficient_data: false },
      academic: { avg_score: 59.5, risk: 'MEDIUM', weakest: 'Math', insufficient_data: false },
      financial: { risk: 'HIGH', months_overdue: 3, outstanding: 3000, insufficient_data: false },
      ai_summary: 'Watch fees.', recommendations: [],
    }
    const card = async (label) => (await screen.findByText(label)).closest('div')

    it('shows every dimension and the real overall score for a finance-visible role', async () => {
      serveAi(full)
      await renderProfile()

      expect(await card('Attendance Risk')).toHaveTextContent('LOW')
      expect(await card('Academic Risk')).toHaveTextContent('Weakest: Math')
      expect(await card('Financial Risk')).toHaveTextContent('3 months overdue')
      expect(await card('Overall Risk Score')).toHaveTextContent('53.5%')
    })

    it('says "Not enough data" instead of a risk level when there is too little to judge', async () => {
      serveAi({
        ...full, overall_risk: 'LOW', risk_score: 10,
        attendance: { rate: null, risk: null, trend: 'no_data', insufficient_data: true },
        academic: { avg_score: null, risk: null, weakest: null, insufficient_data: true },
        financial: { risk: null, months_overdue: 0, outstanding: 0, insufficient_data: true },
      })
      await renderProfile()

      for (const label of ['Attendance Risk', 'Academic Risk', 'Financial Risk']) {
        expect(await card(label)).toHaveTextContent('Not enough data')
      }
      expect(await card('Overall Risk Score')).toHaveTextContent('10%')
    })

    it('leaves out the Financial Risk card when the server hides fees', async () => {
      const { financial, ...noFees } = full
      serveAi({ ...noFees, fees_hidden: true })
      await renderProfile()

      await screen.findByText('Attendance Risk')
      expect(screen.queryByText('Financial Risk')).not.toBeInTheDocument()
    })

    it('shows "Left school" in the header and Overview instead of a risk badge', async () => {
      serveAi({ left_school: true, left_status: 'WITHDRAWN', left_date: '2026-03-01',
        overall_risk: null, risk_score: null, ai_summary: null, recommendations: [] })
      await renderProfile()

      expect(await screen.findAllByText('Left school')).not.toHaveLength(0)
      expect(screen.queryByText(/Risk$/, { selector: 'span' })).not.toBeInTheDocument()
      expect(screen.queryByText('Attendance Risk')).not.toBeInTheDocument()
    })

    it('still shows the header badge from overall_risk', async () => {
      serveAi(full)
      await renderProfile()

      expect(await screen.findByText('MEDIUM Risk')).toBeInTheDocument()
    })
  })

  // ─── Exam results ────────────────────────────────────────────

  describe('academics tab and exam average chip', () => {
    it('lists each exam with date, average, percentages, grades and absences', async () => {
      useStudentApi()
      server.use(http.get('/api/students/5/exam_results/', () => HttpResponse.json([{
        exam_id: 1, exam_name: 'Mid-Term', exam_date: '2026-09-01', average_percentage: 70,
        subjects: [
          { subject: 'Math', marks_obtained: 70, total_marks: 100, percentage: 70, grade: 'B', is_absent: false },
          { subject: 'Urdu', marks_obtained: null, total_marks: 100, percentage: null, grade: null, is_absent: true },
        ],
      }])))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Academics' }))

      expect(await screen.findByText('Mid-Term')).toBeInTheDocument()
      expect(screen.getByText('Average 70%')).toBeInTheDocument()
      expect(screen.getByText('B')).toBeInTheDocument()
      expect(screen.getByText('Absent')).toBeInTheDocument()
    })

    it('shows the last exam percentage and its name on the Exam Average chip', async () => {
      useStudentApi()
      server.use(http.get('/api/students/5/profile_summary/', () => HttpResponse.json({
        exam_average: 78, exam_average_label: 'Mid-Term', latest_exit: null,
      })))
      await renderProfile()

      const chip = (await screen.findByText('Exam Average')).closest('div')
      expect(chip).toHaveTextContent('78%')
      expect(chip).toHaveTextContent('Mid-Term')
    })

    it('says "No exams" when the student has none', async () => {
      useStudentApi()
      server.use(http.get('/api/students/5/profile_summary/', () => HttpResponse.json({
        exam_average: null, latest_exit: null,
      })))
      await renderProfile()

      expect((await screen.findByText('Exam Average')).closest('div')).toHaveTextContent('No exams')
    })
  })

  // ─── Transferred student: earlier branch records ─────────────

  describe('earlier branch records', () => {
    const OLD = 'Branch Old'
    const serve = (path, body) => server.use(http.get(`/api/students/5/${path}/`, () => HttpResponse.json(body)))
    const openTab = async (name) => {
      useStudentApi()
      const user = await renderProfile()
      await user.click(screen.getByRole('button', { name }))
      return user
    }

    it('says on the Overview that the figures include the earlier branch', async () => {
      useStudentApi()
      serve('profile_summary', { has_earlier_branch_data: true, earlier_branches: [OLD], latest_exit: null, attendance_rate: 90 })
      await renderProfile()

      expect(await screen.findByRole('note')).toHaveTextContent(`Includes records from ${OLD}`)
    })

    it('shows no such note for an ordinary student', async () => {
      useStudentApi()
      serve('profile_summary', { has_earlier_branch_data: false, earlier_branches: [], latest_exit: null })
      await renderProfile()

      await screen.findByRole('button', { name: 'Attendance' })
      await waitFor(() => expect(screen.queryByText('Loading summary...')).not.toBeInTheDocument())
      expect(screen.queryByText(/Includes records from/)).not.toBeInTheDocument()
    })

    it('tags attendance months from the earlier branch', async () => {
      serve('attendance_history', { months: [
        { month: 'March 2026', present: 3, absent: 0, late: 0, total: 3, rate: 100, branch: null, read_only: false },
        { month: 'February 2026', present: 8, absent: 2, late: 0, total: 10, rate: 80, branch: OLD, read_only: true },
      ] })
      await openTab('Attendance')

      const rows = await screen.findAllByRole('row')
      expect(within(rows.find((r) => r.textContent.includes('February 2026'))).getByTitle(`From ${OLD} (earlier branch, read-only)`)).toBeInTheDocument()
      expect(within(rows.find((r) => r.textContent.includes('March 2026'))).queryByTitle(/earlier branch/)).not.toBeInTheDocument()
    })

    it('says "Joined from" instead of "Away" for the days before the student joined', async () => {
      useStudentApi({ away_periods: [{ start: '2025-04-01', end: '2026-03-01', reason: 'Joined from Branch Old', joined_from_transfer: true }] })
      serve('attendance_history', { months: [
        { month: 'February 2026', present: 8, absent: 2, late: 0, total: 10, rate: 80, branch: OLD, read_only: true },
      ] })
      const user = await renderProfile()
      await user.click(screen.getByRole('button', { name: 'Attendance' }))

      const note = await screen.findByRole('note')
      expect(note).toHaveTextContent(`from ${OLD}`)
      expect(screen.queryByText('Away from school')).not.toBeInTheDocument()
    })

    it('still shows real time away as Away', async () => {
      useStudentApi({ away_periods: [{ start: '2026-05-01', end: '2026-05-09', reason: 'Visited family', joined_from_transfer: false }] })
      serve('attendance_history', { months: [
        { month: 'May 2026', present: 8, absent: 0, late: 0, total: 8, rate: 100, branch: null, read_only: false },
      ] })
      const user = await renderProfile()
      await user.click(screen.getByRole('button', { name: 'Attendance' }))

      expect(await screen.findByText('Away from school')).toBeInTheDocument()
    })

    it('marks fee rows whose balance moved to the new branch', async () => {
      serve('fee_ledger', [
        { id: 1, month: 2, year: 2026, fee_type: 'MONTHLY', amount_due: '1500', amount_paid: '0', status: 'UNPAID', branch: OLD, read_only: true, handed_over: true, carried: false },
        { id: 2, month: 2, year: 2026, fee_type: 'MONTHLY', amount_due: '1500', amount_paid: '0', status: 'UNPAID', branch: null, read_only: false, handed_over: false, carried: true },
      ])
      await openTab('Fees')

      expect(await screen.findByText('Balance moved to the new branch')).toBeInTheDocument()
      expect(screen.getByText('Carried from the earlier branch')).toBeInTheDocument()
      expect(screen.getByTitle(`From ${OLD} (earlier branch, read-only)`)).toBeInTheDocument()
    })

    it('tags exams of the earlier branch', async () => {
      serve('exam_results', [
        { exam_id: 2, exam_name: 'New Exam', exam_date: '2026-03-20', average_percentage: 90, branch: null, read_only: false,
          subjects: [{ subject: 'Math', marks_obtained: 90, total_marks: 100, percentage: 90, grade: 'A', is_absent: false }] },
        { exam_id: 1, exam_name: 'Old Exam', exam_date: '2026-02-10', average_percentage: 70, branch: OLD, read_only: true,
          subjects: [{ subject: 'Math', marks_obtained: 70, total_marks: 100, percentage: 70, grade: 'B', is_absent: false }] },
      ])
      await openTab('Academics')

      const oldHeader = (await screen.findByText('Old Exam')).closest('div')
      expect(within(oldHeader).getByTitle(`From ${OLD} (earlier branch, read-only)`)).toBeInTheDocument()
      expect(within(screen.getByText('New Exam').closest('div')).queryByTitle(/earlier branch/)).not.toBeInTheDocument()
    })

    it('lists enrollments of both branches with the earlier one tagged', async () => {
      serve('enrollment_history', [
        { academic_year_name: '2026-27', class_name: 'Class 3', section: '', roll_number: '2', status: 'ACTIVE', branch: null },
        { academic_year_name: '2026-27', class_name: 'Class 3', section: '', roll_number: '12', status: 'TRANSFERRED', branch: OLD },
      ])
      await openTab('History')

      expect(await screen.findByTitle(`From ${OLD} (earlier branch, read-only)`)).toBeInTheDocument()
      expect(screen.getAllByText('2026-27')).toHaveLength(2)
    })

    it('offers no Delete on a document from the earlier branch', async () => {
      serve('documents', [
        { id: 1, title: 'Birth certificate', document_type: 'BIRTH_CERT', created_at: '2026-01-02T00:00:00Z', file_url: 'https://x/y', branch: OLD, read_only: true },
        { id: 2, title: 'Admission form', document_type: 'OTHER', created_at: '2026-03-02T00:00:00Z', file_url: 'https://x/z', branch: null, read_only: false },
      ])
      await openTab('Documents')

      const oldRow = (await screen.findByText('Birth certificate')).closest('div.flex')
      const newRow = screen.getByText('Admission form').closest('div.flex')
      expect(within(oldRow).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
      expect(within(newRow).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    })

    it('shows earlier-branch remarks read-only under the editable assessment', async () => {
      mockYear = { id: 1, name: '2025-2026' }
      useStudentApi()
      serve('profile_summary', { has_earlier_branch_data: true, earlier_branches: [OLD], latest_exit: null })
      serve('earlier_assessments', [
        { id: 1, academic_year_name: '2025-26', month: 2, ratings: { listening: 4 }, teacher_remark: 'Keen learner', principal_remark: 'Well done', branch: OLD, read_only: true },
      ])
      server.use(http.get('/api/examinations/student-term-assessment/', () => HttpResponse.json({})))
      const user = await renderProfile()
      await user.click(screen.getByRole('button', { name: 'Assessment' }))

      const earlier = await screen.findByTestId('earlier-assessments')
      expect(earlier).toHaveTextContent('Keen learner')
      expect(earlier).toHaveTextContent('Listening: Very Good')
      expect(within(earlier).queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  // ─── Re-admission and time away ──────────────────────────────

  describe('re-admission', () => {
    const away = [{ start: '2026-03-01', end: '2026-03-20', reason: 'Returned home' }]

    it('offers Re-admit to an admin for a student who has left, and opens the dialog', async () => {
      useStudentApi({ status: 'WITHDRAWN', status_date: '2026-03-01' })
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Re-admit' }))

      expect(await screen.findByRole('heading', { name: 'Re-admit student' })).toBeInTheDocument()
    })

    it.each(['ACTIVE', 'REPEAT'])('does not offer Re-admit for a %s student', async (status) => {
      useStudentApi({ status })
      await renderProfile()

      expect(screen.queryByRole('button', { name: 'Re-admit' })).not.toBeInTheDocument()
    })

    it('does not offer Re-admit to a teacher', async () => {
      mockRole = 'TEACHER'
      useStudentApi({ status: 'WITHDRAWN', status_date: '2026-03-01' })
      await renderProfile()

      expect(screen.queryByRole('button', { name: 'Re-admit' })).not.toBeInTheDocument()
    })

    it('sends Re-admit from the status dialog to re-admission instead of saving it', async () => {
      useStudentApi({ status: 'WITHDRAWN', status_date: '2026-03-01' })
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Status & exit' }))
      const modal = modalFor('Status & exit')
      await user.click(await modal.findByLabelText(/Re-admit/))
      await user.type(modal.getByLabelText('Return date'), '2026-03-20')
      await user.type(modal.getByLabelText('Reason'), 'Back home')
      await user.click(modal.getByRole('button', { name: 'Continue to re-admission' }))

      expect(await screen.findByRole('heading', { name: 'Re-admit student' })).toBeInTheDocument()
      expect(screen.getByLabelText('Return date')).toHaveValue('2026-03-20')
      expect(screen.getByLabelText('Reason')).toHaveValue('Back home')
      expect(patches).toHaveLength(0)
    })

    it('re-admits and refreshes the profile', async () => {
      useStudentApi({ status: 'WITHDRAWN', status_date: '2026-03-01' })
      let body = null
      server.use(http.post('/api/student-exits/readmit/', async ({ request }) => {
        body = await request.json()
        current = { ...current, status: 'ACTIVE', status_date: body.return_date }
        return HttpResponse.json({ student: 5, status: 'ACTIVE', break: {} })
      }))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Re-admit' }))
      await user.click(await screen.findByRole('button', { name: 'Re-admit student' }))

      await waitFor(() => expect(body).not.toBeNull())
      await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Ali Hassan has been re-admitted.'))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Re-admit' })).not.toBeInTheDocument())
    })

    it('lists the time away on the History tab with the reason', async () => {
      useStudentApi({ away_periods: away })
      server.use(http.get('/api/students/5/enrollment_history/', () => HttpResponse.json([
        { academic_year_name: '2025-2026', class_name: 'Class 1A', section: 'A', roll_number: '9', status: 'ACTIVE' },
      ])))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'History' }))

      const note = await screen.findByRole('note')
      expect(note).toHaveTextContent('Away from school')
      expect(note).toHaveTextContent('19 days')
      expect(note).toHaveTextContent('Returned home')
      expect(note).toHaveTextContent('stays empty')
    })

    it('says on the Attendance tab that the time away is not counted as absences', async () => {
      useStudentApi({ away_periods: away })
      server.use(http.get('/api/students/5/attendance_history/', () => HttpResponse.json({
        months: [{ month: 'Feb 2026', present: 18, absent: 2, late: 0, total: 20, rate: 90 }],
      })))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Attendance' }))

      const note = await screen.findByRole('note')
      expect(note).toHaveTextContent('not counted as absences')
      expect(await screen.findByText('Feb 2026')).toBeInTheDocument()
    })

    it('shows no away note for a student who was never away', async () => {
      useStudentApi({ away_periods: [] })
      server.use(http.get('/api/students/5/enrollment_history/', () => HttpResponse.json([
        { academic_year_name: '2025-2026', class_name: 'Class 1A', status: 'ACTIVE' },
      ])))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'History' }))

      await screen.findByText('2025-2026')
      expect(screen.queryByRole('note')).not.toBeInTheDocument()
    })
  })

  // ─── Per-section editing ─────────────────────────────────────

  it('edits one section inline and leaves the other cards alone', async () => {
    const user = await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Edit Guardian' }))

    expect(card('Guardian').getByLabelText('Guardian name')).toBeInTheDocument()
    expect(card('Guardian').getByLabelText('Parent phone')).toBeInTheDocument()
    expect(card('Guardian').queryByLabelText('Date of birth')).not.toBeInTheDocument()
    expect(card('Personal').queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Guardian' })).not.toBeInTheDocument()
  })

  it('saves only the changed fields of that section, then shows the new values', async () => {
    const user = await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Edit Guardian' }))
    const guardian = card('Guardian')
    await user.type(guardian.getByLabelText('Guardian name'), 'Uncle Bob')
    await user.clear(guardian.getByLabelText('Guardian email'))
    await user.type(guardian.getByLabelText('Guardian email'), 'bob@example.com')
    await user.click(guardian.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({ guardian_name: 'Uncle Bob', guardian_email: 'bob@example.com' })
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Student profile updated successfully'))
    await waitFor(() => expect(card('Guardian').getByText('Uncle Bob')).toBeInTheDocument())
    expect(card('Guardian').queryByLabelText('Guardian name')).not.toBeInTheDocument()
    expect(card('Guardian').getByText('bob@example.com')).toBeInTheDocument()
  })

  it('never sends the class, status or untouched fields', async () => {
    const user = await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Edit Personal' }))
    await user.type(card('Personal').getByLabelText('Address'), '12 Main Road')
    await user.click(card('Personal').getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({ address: '12 Main Road' })
  })

  it('closes without a request when nothing changed', async () => {
    const user = await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Edit Personal' }))
    await user.click(card('Personal').getByRole('button', { name: 'Save' }))

    expect(card('Personal').queryByLabelText('Blood group')).not.toBeInTheDocument()
    expect(patches).toHaveLength(0)
  })

  it('Cancel discards the edits', async () => {
    const user = await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Edit Personal' }))
    await user.type(card('Personal').getByLabelText('Address'), 'Somewhere')
    await user.click(card('Personal').getByRole('button', { name: 'Cancel' }))

    expect(patches).toHaveLength(0)
    expect(card('Personal').queryByText('Somewhere')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Personal' }))
    expect(card('Personal').getByLabelText('Address')).toHaveValue('')
  })

  it('shows a client-side validation error under the field and sends nothing', async () => {
    const user = await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Edit Guardian' }))
    const email = card('Guardian').getByLabelText('Guardian email')
    await user.clear(email)
    await user.type(email, 'not-an-email')
    await user.click(card('Guardian').getByRole('button', { name: 'Save' }))

    expect(card('Guardian').getByText('Enter a valid email address')).toBeInTheDocument()
    expect(email).toHaveFocus()
    expect(patches).toHaveLength(0)
  })

  it('shows a server field error beside the field and keeps the card open', async () => {
    server.use(
      http.patch('/api/students/5/', () =>
        HttpResponse.json({ guardian_email: ['Server says this email is taken.'] }, { status: 400 })),
    )
    const user = await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Edit Guardian' }))
    await user.type(card('Guardian').getByLabelText('Guardian name'), 'X')
    await user.click(card('Guardian').getByRole('button', { name: 'Save' }))

    expect(await card('Guardian').findByText('Server says this email is taken.')).toBeInTheDocument()
    expect(card('Guardian').getByLabelText('Guardian email')).toHaveAttribute('aria-invalid', 'true')
    expect(mockShowError).not.toHaveBeenCalled()
  })

  it('shows a non-field server error as a banner in the card', async () => {
    server.use(
      http.patch('/api/students/5/', () => HttpResponse.json({ detail: 'Not allowed.' }, { status: 403 })),
    )
    const user = await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Edit Personal' }))
    await user.type(card('Personal').getByLabelText('Address'), 'x')
    await user.click(card('Personal').getByRole('button', { name: 'Save' }))

    expect(await card('Personal').findByText('Not allowed.')).toBeInTheDocument()
  })

  it('edits name and roll in the Basic card, with a suggestion for the next free roll', async () => {
    const user = await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Edit Basic' }))
    const basic = card('Basic')
    expect(basic.getByText('Class 1A')).toBeInTheDocument()
    expect(basic.queryByLabelText(/^Class/)).not.toBeInTheDocument()

    await user.click(await basic.findByRole('button', { name: 'Suggest 4' }))
    expect(basic.getByLabelText(/roll number/i)).toHaveValue('4')
    await user.click(basic.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(patches).toEqual([{ roll_number: '4' }]))
  })

  describe('optimistic save', () => {
    // Holds the PATCH response until release() so the in-flight state can be inspected.
    function holdPatch(respond) {
      let release
      const gate = new Promise((resolve) => { release = resolve })
      server.use(
        http.patch('/api/students/5/', async ({ request }) => {
          const body = await request.json()
          await gate
          return respond(body)
        }),
      )
      return release
    }

    it('shows the new name in the header while the save is still in flight', async () => {
      const release = holdPatch((body) => {
        current = { ...current, ...body }
        return HttpResponse.json(current)
      })
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Edit Basic' }))
      const name = card('Basic').getByLabelText(/student name/i)
      await user.clear(name)
      await user.type(name, 'Ali H. Hassan')
      await user.click(card('Basic').getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('heading', { name: 'Ali H. Hassan' })).toBeInTheDocument()
      expect(card('Basic').getByRole('button', { name: 'Saving...' })).toBeDisabled()

      release()
      await waitFor(() => expect(card('Basic').queryByRole('button', { name: 'Saving...' })).not.toBeInTheDocument())
      expect(screen.getByRole('heading', { name: 'Ali H. Hassan' })).toBeInTheDocument()
      expect(card('Basic').getByText('Ali H. Hassan')).toBeInTheDocument()
    })

    it('does not flash the old values between saving and the refetch', async () => {
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Edit Personal' }))
      await user.type(card('Personal').getByLabelText('Address'), '12 Main Road')
      await user.click(card('Personal').getByRole('button', { name: 'Save' }))

      // The card is back in read mode and already shows the saved value.
      await waitFor(() => expect(card('Personal').queryByLabelText('Address')).not.toBeInTheDocument())
      expect(card('Personal').getByText('12 Main Road')).toBeInTheDocument()
    })

    it('puts the old name back and shows the error when the server rejects the save', async () => {
      const release = holdPatch(() => HttpResponse.json({ name: ['That name is not allowed.'] }, { status: 400 }))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Edit Basic' }))
      const name = card('Basic').getByLabelText(/student name/i)
      await user.clear(name)
      await user.type(name, 'Forbidden')
      await user.click(card('Basic').getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('heading', { name: 'Forbidden' })).toBeInTheDocument()

      release()

      expect(await card('Basic').findByText('That name is not allowed.')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Ali Hassan' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Forbidden' })).not.toBeInTheDocument()
      // The card stays open with what was typed, ready to correct.
      expect(card('Basic').getByLabelText(/student name/i)).toHaveValue('Forbidden')
      expect(mockShowSuccess).not.toHaveBeenCalled()
    })
  })

  it('lets a teacher edit details but not change class or lifecycle', async () => {
    mockRole = 'TEACHER'
    await renderProfile()

    expect(screen.getByRole('button', { name: 'Edit Guardian' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change class' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Status & exit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reclassify' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate Parent Invite/ })).not.toBeInTheDocument()
  })

  // ─── Status ──────────────────────────────────────────────────

  describe('status & exit', () => {
    it.each([
      ['GRADUATED', /^Graduated/, 'Marked as graduated', 'Mark as graduated'],
      ['REPEAT', /^Repeat/, 'Marked as repeating', 'Mark as repeat'],
    ])('records %s through the outcome endpoint with its reason, not a status PATCH', async (value, label, toast, button) => {
      let body = null
      server.use(http.post('/api/students/5/outcome/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(current)
      }))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Status & exit' }))
      const modal = modalFor('Status & exit')
      await user.click(await modal.findByLabelText(label))
      await user.type(modal.getByLabelText('Reason'), 'Finished the year')
      await user.click(modal.getByRole('button', { name: button }))

      await waitFor(() => expect(body).toEqual({ outcome: value, reason: 'Finished the year' }))
      await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith(toast))
      expect(patches).toHaveLength(0)
    })

    it('needs a reason before anything is sent', async () => {
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Status & exit' }))
      const modal = modalFor('Status & exit')
      await user.click(await modal.findByLabelText(/^Repeat/))
      await user.click(modal.getByRole('button', { name: 'Mark as repeat' }))

      expect(mockShowError).toHaveBeenCalledWith('A reason is required')
      expect(patches).toHaveLength(0)
    })

    it.each([
      ['Left school', /Withdrawn/],
      ['Transferred', /Transferred/],
    ])('hands %s over to the exit checklist instead of saving it', async (label, wizardLabel) => {
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Status & exit' }))
      const modal = modalFor('Status & exit')
      await user.click(await modal.findByLabelText(new RegExp(`^${label}`)))
      await user.type(modal.getByLabelText('Effective date'), '2026-03-01')
      await user.type(modal.getByLabelText('Reason'), 'Moving away')
      await user.click(modal.getByRole('button', { name: 'Continue to checklist' }))

      expect(screen.queryByRole('heading', { name: 'Status & exit' })).not.toBeInTheDocument()
      await screen.findByRole('heading', { name: 'Student exit' })
      const wizard = modalFor('Student exit')
      expect(wizard.getByLabelText('Leaving date')).toHaveValue('2026-03-01')
      expect(wizard.getByLabelText('Reason')).toHaveValue('Moving away')
      expect(wizard.getByLabelText(wizardLabel)).toBeChecked()
      expect(patches).toHaveLength(0)
    })

    it('removing a student entered by mistake opens the typed-name dialog with the reason', async () => {
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Status & exit' }))
      const modal = modalFor('Status & exit')
      await user.click(await modal.findByLabelText(/^Remove/))
      expect(modal.getByText(/has records \(3 attendance, 1 fee\)/)).toBeInTheDocument()
      await user.type(modal.getByLabelText('Reason'), 'entered twice')
      await user.click(modal.getByRole('button', { name: 'Continue to remove' }))

      const remove = modalFor('Remove student')
      expect(remove.getByLabelText('Reason (required)')).toHaveValue('entered twice')
      expect(remove.getByRole('button', { name: 'Remove student' })).toBeDisabled()
    })

    it('shows failures from the outcome endpoint as a toast', async () => {
      server.use(http.post('/api/students/5/outcome/', () => HttpResponse.json({ detail: 'Nope.' }, { status: 400 })))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Status & exit' }))
      const modal = modalFor('Status & exit')
      await user.click(await modal.findByLabelText(/^Graduated/))
      await user.type(modal.getByLabelText('Reason'), 'x')
      await user.click(modal.getByRole('button', { name: 'Mark as graduated' }))

      await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('Nope.'))
    })
  })

  // ─── Reclassify ──────────────────────────────────────────────

  describe('reclassify', () => {
    it('asks for an academic year first', async () => {
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Reclassify' }))

      expect(mockShowError).toHaveBeenCalledWith('Select an academic year from the top switcher first')
      expect(screen.queryByRole('heading', { name: 'Reclassify Student' })).not.toBeInTheDocument()
    })

    it('opens from "Change class" in the Basic card as well', async () => {
      mockYear = { id: 1, name: '2025-2026' }
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Change class' }))

      expect(screen.getByRole('heading', { name: 'Reclassify Student' })).toBeInTheDocument()
    })

    it('requires a target class and a reason', async () => {
      mockYear = { id: 1, name: '2025-2026' }
      let posted = false
      server.use(http.post('/api/students/5/reclassify/', () => {
        posted = true
        return HttpResponse.json({})
      }))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Reclassify' }))
      const modal = modalFor('Reclassify Student')
      await user.click(modal.getByRole('button', { name: 'Apply Reclassification' }))
      expect(modal.getByText('Selected academic year and target class are required')).toBeInTheDocument()

      await waitFor(() => expect(within(modal.getByLabelText('Target Class')).getByText('Class 1A - A')).toBeInTheDocument())
      await user.selectOptions(modal.getByLabelText('Target Class'), 'Class 1A - A')
      await user.click(modal.getByRole('button', { name: 'Apply Reclassification' }))
      expect(modal.getByText('Reason is required')).toBeInTheDocument()
      expect(posted).toBe(false)
    })

    const previewFor = (overrides = {}) => http.get('/api/students/5/reclassify-preview/', () => HttpResponse.json({
      effective_date: '2026-03-01',
      suggested_roll: '4',
      warnings: {},
      fees: { applies: false },
      ...overrides,
    }))

    it('posts the move with the server-suggested roll, the effective date and closes', async () => {
      mockYear = { id: 1, name: '2025-2026' }
      let body = null
      server.use(previewFor(), http.post('/api/students/5/reclassify/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({})
      }))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Reclassify' }))
      const modal = modalFor('Reclassify Student')
      await waitFor(() => expect(within(modal.getByLabelText('Target Class')).getByText('Class 1A - A')).toBeInTheDocument())
      await user.selectOptions(modal.getByLabelText('Target Class'), 'Class 1A - A')
      await waitFor(() => expect(modal.getByLabelText('New Roll Number (optional)')).toHaveValue('4'))
      await user.clear(modal.getByLabelText('Effective date'))
      await user.type(modal.getByLabelText('Effective date'), '2026-03-01')
      await user.type(modal.getByLabelText('Reason'), 'Wrong section at admission')
      await user.click(modal.getByRole('button', { name: 'Apply Reclassification' }))

      await waitFor(() => expect(body).not.toBeNull())
      expect(body).toEqual({
        academic_year_id: 1,
        target_session_class_id: 1,
        target_class_id: 1,
        new_roll_number: '4',
        effective_date: '2026-03-01',
        reason: 'Wrong section at admission',
      })
      await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Student reclassified successfully'))
      expect(screen.queryByRole('heading', { name: 'Reclassify Student' })).not.toBeInTheDocument()
    })

    it('leaves the roll empty until the server has answered', async () => {
      mockYear = { id: 1, name: '2025-2026' }
      let release
      const gate = new Promise((resolve) => { release = resolve })
      server.use(http.get('/api/students/5/reclassify-preview/', async () => {
        await gate
        return HttpResponse.json({ effective_date: '2026-03-01', suggested_roll: '4', warnings: {}, fees: { applies: false } })
      }))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Reclassify' }))
      const modal = modalFor('Reclassify Student')
      await waitFor(() => expect(within(modal.getByLabelText('Target Class')).getByText('Class 1A - A')).toBeInTheDocument())
      await user.selectOptions(modal.getByLabelText('Target Class'), 'Class 1A - A')

      expect(modal.getByLabelText('New Roll Number (optional)')).toHaveValue('')
      release()
      await waitFor(() => expect(modal.getByLabelText('New Roll Number (optional)')).toHaveValue('4'))
    })

    it('warns about records after the effective date', async () => {
      mockYear = { id: 1, name: '2025-2026' }
      server.use(previewFor({ warnings: { attendance_since: 6, fee_rows_since: 2 } }))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Reclassify' }))
      const modal = modalFor('Reclassify Student')
      await waitFor(() => expect(within(modal.getByLabelText('Target Class')).getByText('Class 1A - A')).toBeInTheDocument())
      await user.selectOptions(modal.getByLabelText('Target Class'), 'Class 1A - A')

      const note = await modal.findByRole('note')
      expect(note).toHaveTextContent('6 attendance record(s)')
      expect(note).toHaveTextContent('2 monthly fee row(s)')
    })

    it('shows the fee impact of a different master class and sends the re-price choice', async () => {
      mockYear = { id: 1, name: '2025-2026' }
      let body = null
      server.use(
        previewFor({
          fees: {
            applies: true,
            from_month: { month: 3, year: 2026 },
            can_reprice: true,
            blockers: [],
            annual_note: 'Annual and one-time fees stay with the old class and are not changed.',
            categories: [{ category_id: 1, name: 'Tuition', old_fee: '1000.00', new_fee: '1500.00', student_override: false, months_from_move: [] }],
          },
        }),
        http.post('/api/students/5/reclassify/', async ({ request }) => {
          body = await request.json()
          return HttpResponse.json({})
        }),
      )
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Reclassify' }))
      const modal = modalFor('Reclassify Student')
      await waitFor(() => expect(within(modal.getByLabelText('Target Class')).getByText('Class 1A - A')).toBeInTheDocument())
      await user.selectOptions(modal.getByLabelText('Target Class'), 'Class 1A - A')

      expect(await modal.findByText(/Tuition: 1000.00/)).toHaveTextContent('1500.00')
      expect(modal.getByLabelText(/Keep generated months/)).toBeChecked()
      expect(modal.getByText(/Annual and one-time fees stay with the old class/)).toBeInTheDocument()
      await user.click(modal.getByLabelText(/Re-price unpaid months from March 2026/))
      await user.type(modal.getByLabelText('Reason'), 'Moved up a class')
      await user.click(modal.getByRole('button', { name: 'Apply Reclassification' }))

      await waitFor(() => expect(body).not.toBeNull())
      expect(body.fee_option).toBe('reprice')
    })

    it('disables re-pricing and says why when a month already has a payment', async () => {
      mockYear = { id: 1, name: '2025-2026' }
      server.use(previewFor({
        fees: {
          applies: true,
          from_month: { month: 3, year: 2026 },
          can_reprice: false,
          blockers: ['Tuition: 1 month(s) from March 2026 already have payments.'],
          annual_note: '',
          categories: [{ category_id: 1, name: 'Tuition', old_fee: '1000.00', new_fee: '1500.00', student_override: false, months_from_move: [] }],
        },
      }))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Reclassify' }))
      const modal = modalFor('Reclassify Student')
      await waitFor(() => expect(within(modal.getByLabelText('Target Class')).getByText('Class 1A - A')).toBeInTheDocument())
      await user.selectOptions(modal.getByLabelText('Target Class'), 'Class 1A - A')

      expect(await modal.findByLabelText(/Re-price unpaid months/)).toBeDisabled()
      expect(modal.getByText(/already have payments/)).toBeInTheDocument()
    })

    it('shows a server rejection inside the dialog', async () => {
      mockYear = { id: 1, name: '2025-2026' }
      server.use(http.post('/api/students/5/reclassify/', () =>
        HttpResponse.json({ detail: 'Roll number already taken in target class.' }, { status: 400 })))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Reclassify' }))
      const modal = modalFor('Reclassify Student')
      await waitFor(() => expect(within(modal.getByLabelText('Target Class')).getByText('Class 1A - A')).toBeInTheDocument())
      await user.selectOptions(modal.getByLabelText('Target Class'), 'Class 1A - A')
      await user.type(modal.getByLabelText('Reason'), 'Fix')
      await user.click(modal.getByRole('button', { name: 'Apply Reclassification' }))

      expect(await modal.findByText('Roll number already taken in target class.')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Reclassify Student' })).toBeInTheDocument()
    })
  })

  // ─── Parent invite ───────────────────────────────────────────

  it('generates a parent invite and shows the code and registration link', async () => {
    let body = null
    server.use(http.post('/api/parents/admin/generate-invite/', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ invite_code: 'ABC123XYZ' }, { status: 201 })
    }))
    const user = await renderProfile()

    await user.click(screen.getByRole('button', { name: /Generate Parent Invite/ }))
    const modal = modalFor('Generate Parent Invite')
    await user.selectOptions(modal.getByLabelText('Relation to Student'), 'MOTHER')
    await user.click(modal.getByRole('button', { name: 'Generate Invite' }))

    await waitFor(() => expect(body).toEqual({ student_id: 5, relation: 'MOTHER', parent_phone: '' }))
    expect(await modal.findByLabelText('Invite Code')).toHaveValue('ABC123XYZ')
    expect(modal.getByLabelText('Registration Link')).toHaveValue(`${window.location.origin}/parent/register?code=ABC123XYZ`)
    await user.click(modal.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('heading', { name: 'Generate Parent Invite' })).not.toBeInTheDocument()
  })
})
