import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/utils'
import StudentsPage from '../StudentsPage'

// Tests for the list page's add/edit/delete/filter behaviour. Originally written
// against the pre-refactor page; the edit/add expectations were updated when the
// modal moved onto the shared StudentForm (inline errors, changed-fields-only edit).

let mockRole = 'SCHOOL_ADMIN'
let mockYear = null
const mockSwitchSchool = vi.fn()

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: mockRole, username: 'admin' },
    activeSchool: { id: 1, name: 'Test School', role: mockRole, is_default: true },
    isModuleEnabled: () => true,
    switchSchool: mockSwitchSchool,
  }),
}))

// No year keeps class scope on master classes; a year switches the page to
// session classes (that is when Add Student becomes available).
vi.mock('../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: mockYear }),
}))

const mockShowSuccess = vi.fn()
const mockShowError = vi.fn()
const mockShowWarning = vi.fn()
vi.mock('../../components/Toast', () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showWarning: mockShowWarning,
  }),
}))

vi.mock('../studentExport', () => ({
  exportStudentsPDF: vi.fn(),
  exportStudentsPNG: vi.fn(),
}))

vi.mock('../../hooks/useDebounce', () => ({
  useDebounce: (value) => value,
}))

// The page renders both a card layout and a table, so every row appears twice.
const firstButton = (name) => screen.getAllByRole('button', { name })[0]
const modalFor = (title) => within(screen.getByRole('heading', { name: title }).closest('.fixed'))

async function renderLoaded() {
  const user = userEvent.setup()
  renderWithProviders(<StudentsPage />)
  await waitFor(() => {
    expect(screen.getAllByText('Sara Khan').length).toBeGreaterThanOrEqual(1)
  })
  return user
}

describe('StudentsPage — list, edit, delete, add', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRole = 'SCHOOL_ADMIN'
    mockYear = null
  })

  // ─── Filters ─────────────────────────────────────────────────

  it('narrows the list by name search', async () => {
    const user = await renderLoaded()

    await user.type(screen.getByPlaceholderText(/search by name or roll number/i), 'sara')

    await waitFor(() => {
      expect(screen.queryAllByText('Ali Hassan')).toHaveLength(0)
    })
    expect(screen.getAllByText('Sara Khan').length).toBeGreaterThanOrEqual(1)
  })

  describe('current / left / all', () => {
    const current = { id: 1, school: 1, class_obj: 1, class_name: 'Class 1A', roll_number: '1', name: 'Ali Hassan', is_active: true, status: 'ACTIVE', has_user_account: true, user_username: 'ali' }
    const withdrawn = { id: 9, school: 1, class_obj: 1, class_name: 'Class 1A', roll_number: '9', name: 'Zara Left', is_active: true, status: 'WITHDRAWN', left_date: '2026-01-10', has_user_account: false, transferred_to: null }
    const transferred = {
      id: 10, school: 1, class_obj: 1, class_name: 'Class 1A', roll_number: '10', name: 'Omar Moved', is_active: true, status: 'TRANSFERRED',
      left_date: '2026-02-01', has_user_account: false,
      transferred_to: { school_name: 'Branch 2', student_id: 77, school_id: 2 },
    }
    let requests

    // The server decides who is listed: the default asks for current students only.
    const serve = () => {
      requests = []
      server.use(http.get('/api/students/', ({ request }) => {
        const scope = new URL(request.url).searchParams.get('status_scope')
        requests.push(scope)
        if (scope === 'left') return HttpResponse.json([withdrawn, transferred])
        if (scope === 'all') return HttpResponse.json([current, withdrawn, transferred])
        return HttpResponse.json([current])
      }))
    }

    it('lists only current students by default and does not ask the server for more', async () => {
      serve()
      renderWithProviders(<StudentsPage />)
      await waitFor(() => expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1))

      expect(screen.queryAllByText('Zara Left')).toHaveLength(0)
      expect(requests).toEqual([null])
      expect(screen.getByRole('radio', { name: 'Current' })).toHaveAttribute('aria-checked', 'true')
    })

    it('shows withdrawn and transferred students under Left, with the date they left', async () => {
      serve()
      const user = userEvent.setup()
      renderWithProviders(<StudentsPage />)
      await waitFor(() => expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1))

      await user.click(screen.getByRole('radio', { name: 'Left' }))

      await waitFor(() => expect(screen.getAllByText('Zara Left').length).toBeGreaterThanOrEqual(1))
      expect(requests).toContain('left')
      expect(screen.queryAllByText('Ali Hassan')).toHaveLength(0)
      expect(screen.getByTestId('left-note-9')).toHaveTextContent('Left')
      expect(screen.getByTestId('left-note-9')).toHaveTextContent('2026')
    })

    it('has a filter for every status, not only Left', async () => {
      serve()
      renderWithProviders(<StudentsPage />)
      await waitFor(() => expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1))

      const names = screen.getAllByRole('radio').map((r) => r.textContent)
      expect(names).toEqual(['Current', 'Left', 'Withdrawn', 'Transferred', 'Graduated', 'Suspended', 'Repeat', 'All'])
    })

    it.each([
      ['Withdrawn', 'withdrawn'], ['Transferred', 'transferred'], ['Graduated', 'graduated'],
      ['Suspended', 'suspended'], ['Repeat', 'repeat'],
    ])('asks the server for exactly %s students', async (label, scope) => {
      serve()
      const user = userEvent.setup()
      renderWithProviders(<StudentsPage />)
      await waitFor(() => expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1))

      await user.click(screen.getByRole('radio', { name: label }))

      await waitFor(() => expect(requests).toContain(scope))
      expect(screen.getByRole('radio', { name: label })).toHaveAttribute('aria-checked', 'true')
    })

    it('shows everyone under All', async () => {
      serve()
      const user = userEvent.setup()
      renderWithProviders(<StudentsPage />)
      await waitFor(() => expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1))

      await user.click(screen.getByRole('radio', { name: 'All' }))

      await waitFor(() => expect(screen.getAllByText('Zara Left').length).toBeGreaterThanOrEqual(1))
      expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Omar Moved').length).toBeGreaterThanOrEqual(1)
    })

    it('shows where a transferred student went and opens them there', async () => {
      serve()
      mockSwitchSchool.mockResolvedValue({})
      const user = userEvent.setup()
      renderWithProviders(<StudentsPage />)
      await waitFor(() => expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1))
      await user.click(screen.getByRole('radio', { name: 'Left' }))

      const note = await screen.findByTestId('left-note-10')
      expect(note).toHaveTextContent('to Branch 2')
      await user.click(within(note).getByRole('button', { name: 'Open there' }))

      expect(mockSwitchSchool).toHaveBeenCalledWith(2)
    })

    it('shows the destination but no link when the viewer cannot open that branch', async () => {
      requests = []
      server.use(http.get('/api/students/', () => HttpResponse.json([
        { ...transferred, transferred_to: { school_name: 'Branch 2', student_id: null, school_id: null } },
      ])))
      const user = userEvent.setup()
      renderWithProviders(<StudentsPage />)
      await user.click(await screen.findByRole('radio', { name: 'Left' }))

      const note = await screen.findByTestId('left-note-10')
      expect(note).toHaveTextContent('to Branch 2')
      expect(within(note).queryByRole('button', { name: 'Open there' })).not.toBeInTheDocument()
    })

    it('counts current and left students in the summary cards', async () => {
      serve()
      const user = userEvent.setup()
      renderWithProviders(<StudentsPage />)
      await waitFor(() => expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1))
      await user.click(screen.getByRole('radio', { name: 'All' }))
      await waitFor(() => expect(screen.getAllByText('Zara Left').length).toBeGreaterThanOrEqual(1))

      expect(screen.getByText('Current', { selector: 'p' }).closest('div')).toHaveTextContent('1')
      expect(screen.getByText('Left', { selector: 'p' }).closest('div')).toHaveTextContent('2')
    })
  })

  // ─── Edit ────────────────────────────────────────────────────

  it('opens the edit modal with every field prefilled and the class shown read-only', async () => {
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))

    const modal = modalFor('Edit Student')
    expect(modal.getByLabelText(/student name/i)).toHaveValue('Ali Hassan')
    expect(modal.getByLabelText(/roll number/i)).toHaveValue('1')
    expect(modal.getByLabelText('Parent name')).toHaveValue('Hassan Sr')
    expect(modal.getByLabelText('Guardian email')).toBeInTheDocument()
    expect(modal.queryByLabelText(/^Class/)).not.toBeInTheDocument()
    expect(modal.getByText('Class 1A')).toBeInTheDocument()
    expect(modal.getByRole('button', { name: 'Change class' })).toBeEnabled()
  })

  it('tells a teacher the class cannot be changed, with no Change class button', async () => {
    mockRole = 'TEACHER'
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    const modal = modalFor('Edit Student')

    expect(modal.getByText(/class cannot be changed here/i)).toBeInTheDocument()
    expect(modal.queryByRole('button', { name: 'Change class' })).not.toBeInTheDocument()
  })

  describe('Change class', () => {
    it('is disabled while there are unsaved edits', async () => {
      const user = await renderLoaded()

      await user.click(firstButton('Edit'))
      const modal = modalFor('Edit Student')
      await user.type(modal.getByLabelText('Blood group'), 'A')

      expect(modal.getByRole('button', { name: 'Change class' })).toBeDisabled()
    })

    it('asks for an academic year first and keeps the edit form open', async () => {
      const user = await renderLoaded()

      await user.click(firstButton('Edit'))
      await user.click(modalFor('Edit Student').getByRole('button', { name: 'Change class' }))

      expect(mockShowError).toHaveBeenCalledWith('Select an academic year from the top switcher first')
      expect(screen.getByRole('heading', { name: 'Edit Student' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Reclassify Student' })).not.toBeInTheDocument()
    })

    it('closes the edit form and opens the reclassify dialog for that student', async () => {
      mockYear = { id: 1, name: '2025-2026' }
      let body = null
      let studentId = null
      server.use(
        http.post('/api/students/:id/reclassify/', async ({ request, params }) => {
          body = await request.json()
          studentId = params.id
          return HttpResponse.json({})
        }),
      )
      const user = await renderLoaded()

      await user.click(firstButton('Edit'))
      await user.click(modalFor('Edit Student').getByRole('button', { name: 'Change class' }))

      expect(screen.queryByRole('heading', { name: 'Edit Student' })).not.toBeInTheDocument()
      const modal = modalFor('Reclassify Student')
      await waitFor(() => expect(within(modal.getByLabelText('Target Class')).getByText('Class 1A - A')).toBeInTheDocument())
      await user.selectOptions(modal.getByLabelText('Target Class'), 'Class 1A - A')
      await user.type(modal.getByLabelText('Reason'), 'Wrong section')
      await user.click(modal.getByRole('button', { name: 'Apply Reclassification' }))

      await waitFor(() => expect(body).not.toBeNull())
      expect(studentId).toBe('1')
      expect(body).toMatchObject({ academic_year_id: 1, target_session_class_id: 1, reason: 'Wrong section' })
      await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Student reclassified successfully'))
      expect(screen.queryByRole('heading', { name: 'Reclassify Student' })).not.toBeInTheDocument()
    })
  })

  it('PATCHes only the changed fields, never the class, then closes', async () => {
    let patched = null
    server.use(
      http.patch('/api/students/:id/', async ({ request, params }) => {
        patched = { id: params.id, body: await request.json() }
        return HttpResponse.json({ id: Number(params.id), ...patched.body })
      }),
    )
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    const modal = modalFor('Edit Student')
    const nameInput = modal.getByLabelText(/student name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Ali H. Hassan')
    await user.click(modal.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(patched).not.toBeNull())
    expect(patched.id).toBe('1')
    expect(patched.body).toEqual({ name: 'Ali H. Hassan' })
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Student updated successfully!'))
    expect(screen.queryByRole('heading', { name: 'Edit Student' })).not.toBeInTheDocument()
  })

  it('updates the list row at once while the save is in flight, and puts it back if the save fails', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    server.use(
      http.patch('/api/students/:id/', async () => {
        await gate
        return HttpResponse.json({ name: ['Rejected.'] }, { status: 400 })
      }),
    )
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    const modal = modalFor('Edit Student')
    const nameInput = modal.getByLabelText(/student name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Ali Renamed')
    await user.click(modal.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(screen.getAllByText('Ali Renamed').length).toBeGreaterThanOrEqual(1))
    expect(screen.queryAllByText('Ali Hassan')).toHaveLength(0)

    release()

    expect(await modal.findByText('Rejected.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryAllByText('Ali Renamed')).toHaveLength(0))
    expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1)
  })

  it('edits fields the old modal could not reach, such as guardian details', async () => {
    let body = null
    server.use(
      http.patch('/api/students/:id/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({})
      }),
    )
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    const modal = modalFor('Edit Student')
    await user.type(modal.getByLabelText('Guardian email'), 'guardian@example.com')
    await user.selectOptions(modal.getByLabelText('Gender'), 'F')
    await user.click(modal.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({ guardian_email: 'guardian@example.com', gender: 'F' })
  })

  it('closes without a request when nothing was changed', async () => {
    let called = false
    server.use(
      http.patch('/api/students/:id/', () => {
        called = true
        return HttpResponse.json({})
      }),
    )
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    await user.click(modalFor('Edit Student').getByRole('button', { name: 'Save Changes' }))

    expect(screen.queryByRole('heading', { name: 'Edit Student' })).not.toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('shows an inline error and sends nothing when the name is cleared', async () => {
    let called = false
    server.use(
      http.patch('/api/students/:id/', () => {
        called = true
        return HttpResponse.json({})
      }),
    )
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    const modal = modalFor('Edit Student')
    await user.clear(modal.getByLabelText(/student name/i))
    await user.click(modal.getByRole('button', { name: 'Save Changes' }))

    expect(modal.getByText('Student name is required')).toBeInTheDocument()
    expect(modal.getByLabelText(/student name/i)).toHaveFocus()
    expect(called).toBe(false)
    expect(mockShowError).not.toHaveBeenCalled()
  })

  it('validates a changed guardian email on the client', async () => {
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    const modal = modalFor('Edit Student')
    await user.type(modal.getByLabelText('Guardian email'), 'nope')
    await user.click(modal.getByRole('button', { name: 'Save Changes' }))

    expect(modal.getByText('Enter a valid email address')).toBeInTheDocument()
  })

  it('shows the server roll-number error under the roll field and keeps the modal open', async () => {
    server.use(
      http.patch('/api/students/:id/', () =>
        HttpResponse.json({ roll_number: ['Roll number already exists in this class.'] }, { status: 400 })),
    )
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    const modal = modalFor('Edit Student')
    const roll = modal.getByLabelText(/roll number/i)
    await user.clear(roll)
    await user.type(roll, '2')
    await user.click(modal.getByRole('button', { name: 'Save Changes' }))

    expect(await modal.findByText(/Roll number already exists in this class\./)).toBeInTheDocument()
    expect(roll).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('heading', { name: 'Edit Student' })).toBeInTheDocument()
    expect(mockShowError).not.toHaveBeenCalled()
  })

  it('shows a non-field server error as a banner in the modal', async () => {
    server.use(
      http.patch('/api/students/:id/', () => HttpResponse.json({ detail: 'You cannot edit this student.' }, { status: 403 })),
    )
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    const modal = modalFor('Edit Student')
    await user.type(modal.getByLabelText('Blood group'), 'O+')
    await user.click(modal.getByRole('button', { name: 'Save Changes' }))

    expect(await modal.findByText('You cannot edit this student.')).toBeInTheDocument()
  })

  it('asks before discarding unsaved edits, and keeps them if you choose to keep editing', async () => {
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    const modal = modalFor('Edit Student')
    await user.type(modal.getByLabelText('Blood group'), 'A')
    await user.click(modal.getByRole('button', { name: 'Cancel' }))

    expect(modal.getByText('Discard your unsaved changes?')).toBeInTheDocument()
    await user.click(modal.getByRole('button', { name: 'Keep editing' }))
    expect(modal.getByLabelText('Blood group')).toHaveValue('A')

    await user.keyboard('{Escape}')
    expect(modal.getByText('Discard your unsaved changes?')).toBeInTheDocument()
    await user.click(modal.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('heading', { name: 'Edit Student' })).not.toBeInTheDocument()
  })

  it('closes straight away when nothing was typed', async () => {
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    await user.click(modalFor('Edit Student').getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('heading', { name: 'Edit Student' })).not.toBeInTheDocument()
  })

  // ─── Delete ──────────────────────────────────────────────────

  it('deletes a student after confirmation', async () => {
    let deletedId = null
    server.use(
      http.delete('/api/students/:id/', ({ params }) => {
        deletedId = params.id
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = await renderLoaded()

    await user.click(firstButton('Delete'))
    const modal = modalFor('Delete Student')
    expect(modal.getByText('Ali Hassan')).toBeInTheDocument()
    await user.click(modal.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deletedId).toBe('1'))
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Student deleted successfully!'))
  })

  it('does not delete when the confirmation is cancelled', async () => {
    let called = false
    server.use(
      http.delete('/api/students/:id/', () => {
        called = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = await renderLoaded()

    await user.click(firstButton('Delete'))
    await user.click(modalFor('Delete Student').getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('heading', { name: 'Delete Student' })).not.toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('hides Delete from roles that cannot manage the student lifecycle', async () => {
    mockRole = 'TEACHER'
    await renderLoaded()

    expect(screen.queryAllByRole('button', { name: 'Delete' })).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThanOrEqual(1)
  })

  // ─── Add ─────────────────────────────────────────────────────

  it('disables Add Student when there is no current academic year', async () => {
    await renderLoaded()

    expect(screen.getByRole('button', { name: 'Add Student' })).toBeDisabled()
  })

  describe('with an academic year', () => {
    beforeEach(() => {
      mockYear = { id: 1, name: '2025-2026' }
    })

    async function openAdd() {
      const user = await renderLoaded()
      await user.click(screen.getByRole('button', { name: 'Add Student' }))
      const modal = modalFor('Add Student')
      const classSelect = modal.getByLabelText(/^Class/)
      await waitFor(() => expect(within(classSelect).getByText('Class 1A - A')).toBeInTheDocument())
      return { user, modal, classSelect }
    }

    it('shows only the quick fields at first and reveals the rest on request', async () => {
      const { user, modal } = await openAdd()

      expect(modal.getByLabelText(/student name/i)).toBeInTheDocument()
      expect(modal.getByLabelText('Parent phone')).toBeInTheDocument()
      expect(modal.queryByLabelText('Guardian email')).not.toBeInTheDocument()

      await user.click(modal.getByRole('button', { name: 'Show more fields' }))
      expect(modal.getByLabelText('Guardian email')).toBeInTheDocument()
      expect(modal.getByLabelText('Date of birth')).toBeInTheDocument()

      await user.click(modal.getByRole('button', { name: 'Show fewer fields' }))
      expect(modal.queryByLabelText('Guardian email')).not.toBeInTheDocument()
    })

    it('asks for a class, inline, before creating a student', async () => {
      const { user, modal } = await openAdd()

      await user.type(modal.getByLabelText(/student name/i), 'New Pupil')
      await user.type(modal.getByLabelText(/roll number/i), '9')
      await user.click(modal.getByRole('button', { name: 'Add Student' }))

      expect(modal.getByText('Please select a class')).toBeInTheDocument()
    })

    it('requires name and roll number', async () => {
      const { user, modal, classSelect } = await openAdd()

      await user.selectOptions(classSelect, 'Class 1A - A')
      await user.clear(modal.getByLabelText(/roll number/i))
      await user.click(modal.getByRole('button', { name: 'Add Student' }))

      expect(modal.getByText('Student name is required')).toBeInTheDocument()
      expect(modal.getByText('Roll number is required')).toBeInTheDocument()
    })

    it('suggests the next free roll for the chosen class and fills it in', async () => {
      const { user, modal, classSelect } = await openAdd()
      expect(modal.getByLabelText(/roll number/i)).toHaveValue('')

      await user.selectOptions(classSelect, 'Class 1A - A')

      expect(modal.getByLabelText(/roll number/i)).toHaveValue('4')
      expect(modal.getByRole('button', { name: 'Suggest 4' })).toBeInTheDocument()
    })

    it('does not treat an auto-filled roll as an unsaved edit', async () => {
      const { user, modal, classSelect } = await openAdd()
      await user.selectOptions(classSelect, 'Class 1A - A')

      await user.click(modal.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('heading', { name: 'Add Student' })).not.toBeInTheDocument()
    })

    it('POSTs the new student with the master class resolved from the session class', async () => {
      let created = null
      server.use(
        http.post('/api/students/', async ({ request }) => {
          created = await request.json()
          return HttpResponse.json({ id: 77, ...created }, { status: 201 })
        }),
      )
      const { user, modal, classSelect } = await openAdd()

      await user.selectOptions(classSelect, 'Class 1A - A')
      const roll = modal.getByLabelText(/roll number/i)
      await user.clear(roll)
      await user.type(roll, '10')
      await user.type(modal.getByLabelText(/student name/i), 'New Pupil')
      await user.type(modal.getByLabelText('Parent phone'), '0300-4444444')
      await user.click(modal.getByRole('button', { name: 'Add Student' }))

      await waitFor(() => expect(created).not.toBeNull())
      expect(created).toMatchObject({
        school: 1, class_obj: 1, name: 'New Pupil', roll_number: '10', parent_phone: '+923004444444',
      })
      await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Student added successfully!'))
      expect(screen.queryByRole('heading', { name: 'Add Student' })).not.toBeInTheDocument()
    })

    it('creates a portal login after the student when asked, with the username suggested from the name', async () => {
      let account = null
      server.use(
        http.post('/api/students/', async ({ request }) => HttpResponse.json({ id: 78, ...(await request.json()) }, { status: 201 })),
        http.post('/api/students/:id/create-user-account/', async ({ request, params }) => {
          account = { id: params.id, body: await request.json() }
          return HttpResponse.json({ username: 'new_pupil' }, { status: 201 })
        }),
      )
      const { user, modal, classSelect } = await openAdd()

      await user.selectOptions(classSelect, 'Class 1A - A')
      await user.type(modal.getByLabelText(/student name/i), 'New Pupil')
      await user.click(modal.getByLabelText(/create user account/i))
      expect(modal.getByPlaceholderText('Login username')).toHaveValue('new_pupil')
      await user.type(modal.getByPlaceholderText('Min 8 chars'), 'Student@123')
      await user.type(modal.getByPlaceholderText('Confirm'), 'Student@123')
      await user.click(modal.getByRole('button', { name: 'Add Student' }))

      await waitFor(() => expect(account).not.toBeNull())
      expect(account.id).toBe('78')
      expect(account.body).toMatchObject({ username: 'new_pupil', password: 'Student@123' })
      await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Student and user account created successfully!'))
    })

    it('does not create anything when the login details are incomplete', async () => {
      let created = false
      server.use(
        http.post('/api/students/', () => {
          created = true
          return HttpResponse.json({}, { status: 201 })
        }),
      )
      const { user, modal, classSelect } = await openAdd()

      await user.selectOptions(classSelect, 'Class 1A - A')
      await user.type(modal.getByLabelText(/student name/i), 'New Pupil')
      await user.click(modal.getByLabelText(/create user account/i))
      await user.click(modal.getByRole('button', { name: 'Add Student' }))

      expect(modal.getByText('Username and password are required for user account.')).toBeInTheDocument()
      expect(created).toBe(false)
    })

    it('opens the full form when the server rejects a field that was hidden', async () => {
      server.use(
        http.post('/api/students/', () =>
          HttpResponse.json({ guardian_email: ['Enter a valid email address.'] }, { status: 400 })),
      )
      const { user, modal, classSelect } = await openAdd()

      await user.selectOptions(classSelect, 'Class 1A - A')
      await user.type(modal.getByLabelText(/student name/i), 'New Pupil')
      await user.click(modal.getByRole('button', { name: 'Add Student' }))

      expect(await modal.findByLabelText('Guardian email')).toHaveAttribute('aria-invalid', 'true')
      expect(modal.getByText('Enter a valid email address.')).toBeInTheDocument()
    })
  })
})
