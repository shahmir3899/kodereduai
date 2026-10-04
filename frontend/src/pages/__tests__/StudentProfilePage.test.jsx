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

    it('shows no fee chip when nothing is pending', async () => {
      serveSummary({ pending_fee: 0, latest_exit: null })
      await renderProfile()

      await waitFor(() => expect(screen.queryByText(/Pending fee:/)).not.toBeInTheDocument())
    })

    it('shows the exit banner with each waived item, who waived it and why', async () => {
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
      serveSummary({ pending_fee: 0, latest_exit: { ...waivedExit, exit_type: 'TRANSFERRED', destination_school_name: 'Branch 2', items: [] } })
      await renderProfile()

      expect(await screen.findByRole('status')).toHaveTextContent('Transferred to Branch 2 on')
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
    expect(screen.queryByRole('button', { name: 'Update Status' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reclassify' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate Parent Invite/ })).not.toBeInTheDocument()
  })

  // ─── Status ──────────────────────────────────────────────────

  describe('status update', () => {
    it('saves a status that does not leave the school directly, with its date and reason', async () => {
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Update Status' }))
      const modal = modalFor('Update Student Status')
      await user.selectOptions(modal.getByLabelText('Status'), 'SUSPENDED')
      await user.type(modal.getByLabelText('Effective Date'), '2026-03-01')
      await user.type(modal.getByLabelText('Reason'), 'Disciplinary')
      await user.click(modal.getByRole('button', { name: 'Save Status' }))

      await waitFor(() => expect(patches).toHaveLength(1))
      expect(patches[0]).toEqual({ status: 'SUSPENDED', status_date: '2026-03-01', status_reason: 'Disciplinary' })
      await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Student status updated successfully'))
      expect(screen.queryByRole('heading', { name: 'Update Student Status' })).not.toBeInTheDocument()
    })

    it.each([
      ['WITHDRAWN', 'Withdrawn'],
      ['TRANSFERRED', 'Transferred'],
    ])('hands %s over to the exit checklist instead of saving it', async (value) => {
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Update Status' }))
      const modal = modalFor('Update Student Status')
      await user.selectOptions(modal.getByLabelText('Status'), value)
      await user.type(modal.getByLabelText('Effective Date'), '2026-03-01')
      await user.type(modal.getByLabelText('Reason'), 'Moving away')
      expect(modal.getByText(/short checklist/i)).toBeInTheDocument()
      await user.click(modal.getByRole('button', { name: 'Continue to checklist' }))

      expect(screen.queryByRole('heading', { name: 'Update Student Status' })).not.toBeInTheDocument()
      await screen.findByRole('heading', { name: 'Student exit' })
      const wizard = modalFor('Student exit')
      expect(wizard.getByLabelText('Leaving date')).toHaveValue('2026-03-01')
      expect(wizard.getByLabelText('Reason')).toHaveValue('Moving away')
      expect(wizard.getByLabelText(value === 'WITHDRAWN' ? /Withdrawn/ : /Transferred/)).toBeChecked()
      expect(patches).toHaveLength(0)
    })

    it('shows other failures as a toast', async () => {
      server.use(http.patch('/api/students/5/', () => HttpResponse.json({ detail: 'Nope.' }, { status: 403 })))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Update Status' }))
      await user.click(modalFor('Update Student Status').getByRole('button', { name: 'Save Status' }))

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

    it('posts the correction with the suggested roll and closes', async () => {
      mockYear = { id: 1, name: '2025-2026' }
      let body = null
      server.use(http.post('/api/students/5/reclassify/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({})
      }))
      const user = await renderProfile()

      await user.click(screen.getByRole('button', { name: 'Reclassify' }))
      const modal = modalFor('Reclassify Student')
      await waitFor(() => expect(within(modal.getByLabelText('Target Class')).getByText('Class 1A - A')).toBeInTheDocument())
      await user.selectOptions(modal.getByLabelText('Target Class'), 'Class 1A - A')
      await waitFor(() => expect(modal.getByLabelText('New Roll Number (optional)')).toHaveValue('4'))
      await user.type(modal.getByLabelText('Reason'), 'Wrong section at admission')
      await user.click(modal.getByRole('button', { name: 'Apply Reclassification' }))

      await waitFor(() => expect(body).not.toBeNull())
      expect(body).toEqual({
        academic_year_id: 1,
        target_session_class_id: 1,
        target_class_id: 1,
        new_roll_number: '4',
        reason: 'Wrong section at admission',
      })
      await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Student reclassified successfully'))
      expect(screen.queryByRole('heading', { name: 'Reclassify Student' })).not.toBeInTheDocument()
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
