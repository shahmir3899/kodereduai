import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/utils'
import StudentsPage from '../StudentsPage'

// Characterization tests for the list page's add/edit/delete/filter behaviour.
// They pin what StudentsPage does today so the form refactor (shared StudentForm,
// page split) can be checked against it; they are not a spec for the final UI.

let mockRole = 'SCHOOL_ADMIN'
let mockYear = null

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: mockRole, username: 'admin' },
    activeSchool: { id: 1, name: 'Test School', role: mockRole, is_default: true },
    isModuleEnabled: () => true,
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

  it('hides inactive students until "Show inactive records" is ticked', async () => {
    server.use(
      http.get('/api/students/', () => HttpResponse.json([
        { id: 1, school: 1, class_obj: 1, class_name: 'Class 1A', roll_number: '1', name: 'Ali Hassan', is_active: true, status: 'ACTIVE', has_user_account: true, user_username: 'ali' },
        { id: 9, school: 1, class_obj: 1, class_name: 'Class 1A', roll_number: '9', name: 'Zara Left', is_active: false, status: 'WITHDRAWN', has_user_account: false },
      ])),
    )
    const user = userEvent.setup()
    renderWithProviders(<StudentsPage />)
    await waitFor(() => {
      expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.queryAllByText('Zara Left')).toHaveLength(0)

    await user.click(screen.getByLabelText(/show inactive records/i))

    await waitFor(() => {
      expect(screen.getAllByText('Zara Left').length).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── Edit ────────────────────────────────────────────────────

  it('opens the edit modal prefilled, with the class locked', async () => {
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))

    const modal = modalFor('Edit Student')
    expect(modal.getByDisplayValue('Ali Hassan')).toBeInTheDocument()
    expect(modal.getByDisplayValue('Hassan Sr')).toBeInTheDocument()
    expect(modal.getByRole('combobox')).toBeDisabled()
    expect(modal.getByText(/class cannot be changed after creation/i)).toBeInTheDocument()
  })

  it('PATCHes only name, roll and parent fields — never the class — then closes', async () => {
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
    const nameInput = modal.getByDisplayValue('Ali Hassan')
    await user.clear(nameInput)
    await user.type(nameInput, 'Ali H. Hassan')
    await user.click(modal.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(patched).not.toBeNull())
    expect(patched.id).toBe('1')
    expect(Object.keys(patched.body).sort()).toEqual(['name', 'parent_name', 'parent_phone', 'roll_number'])
    expect(patched.body.name).toBe('Ali H. Hassan')
    expect(patched.body.roll_number).toBe('1')
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Student updated successfully!'))
    expect(screen.queryByRole('heading', { name: 'Edit Student' })).not.toBeInTheDocument()
  })

  it('blocks saving when name is cleared and shows a toast', async () => {
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
    await user.clear(modal.getByDisplayValue('Ali Hassan'))
    await user.click(modal.getByRole('button', { name: 'Save Changes' }))

    expect(mockShowError).toHaveBeenCalledWith('Name and Roll Number are required')
    expect(called).toBe(false)
    expect(screen.getByRole('heading', { name: 'Edit Student' })).toBeInTheDocument()
  })

  it('shows the server roll-number error and keeps the modal open', async () => {
    server.use(
      http.patch('/api/students/:id/', () =>
        HttpResponse.json({ roll_number: ['Roll number already exists in this class.'] }, { status: 400 })),
    )
    const user = await renderLoaded()

    await user.click(firstButton('Edit'))
    await user.click(modalFor('Edit Student').getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(
        expect.stringContaining('Roll number already exists in this class.'),
      )
    })
    expect(screen.getByRole('heading', { name: 'Edit Student' })).toBeInTheDocument()
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

  it('asks for a class before creating a student', async () => {
    mockYear = { id: 1, name: '2025-2026' }
    const user = await renderLoaded()

    await user.click(screen.getByRole('button', { name: 'Add Student' }))
    await user.click(modalFor('Add Student').getByRole('button', { name: 'Add Student' }))

    expect(mockShowError).toHaveBeenCalledWith('Please select a class')
  })

  it('POSTs the new student with the master class resolved from the session class', async () => {
    mockYear = { id: 1, name: '2025-2026' }
    let created = null
    server.use(
      http.post('/api/students/', async ({ request }) => {
        created = await request.json()
        return HttpResponse.json({ id: 77, ...created }, { status: 201 })
      }),
    )
    const user = await renderLoaded()

    await user.click(screen.getByRole('button', { name: 'Add Student' }))
    const modal = modalFor('Add Student')
    const classSelect = modal.getByRole('combobox')
    await waitFor(() => expect(within(classSelect).getByText('Class 1A - A')).toBeInTheDocument())
    await user.selectOptions(classSelect, 'Class 1A - A')

    const [rollInput, nameInput] = modal.getAllByRole('textbox')
    await user.clear(rollInput)
    await user.type(rollInput, '10')
    await user.type(nameInput, 'New Pupil')
    await user.click(modal.getByRole('button', { name: 'Add Student' }))

    await waitFor(() => expect(created).not.toBeNull())
    expect(created).toMatchObject({ school: 1, class_obj: 1, name: 'New Pupil', roll_number: '10' })
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Student added successfully!'))
  })
})
