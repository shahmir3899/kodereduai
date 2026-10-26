import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/utils'
import AcademicYearsPage from './AcademicYearsPage'

const toast = { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(), addToast: vi.fn() }
const auth = { isSchoolAdmin: true }

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN', schools: [{ id: 1 }] },
    activeSchool: { id: 1, name: 'Test School' },
    isSchoolAdmin: auth.isSchoolAdmin,
  }),
}))
vi.mock('../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ refresh: vi.fn(), activeAcademicYear: null }),
}))
vi.mock('../../components/Toast', () => ({ useToast: () => toast }))

const year = { id: 1, name: '2026-2027', start_date: '2026-04-01', end_date: '2027-03-31', is_current: true, terms_count: 0, enrollment_count: 0 }

describe('Academic Sessions page', () => {
  beforeEach(() => {
    Object.values(toast).forEach((f) => f.mockClear())
    auth.isSchoolAdmin = true
    server.use(
      http.get('/api/sessions/academic-years/', () => HttpResponse.json({ count: 1, results: [year] })),
      http.get('/api/sessions/terms/', () => HttpResponse.json({ count: 0, results: [] })),
      http.post('/api/sessions/academic-years/', () => HttpResponse.json({ id: 2 }, { status: 201 })),
    )
  })

  it('says "Academic year added" after Create', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AcademicYearsPage />)
    await user.click(await screen.findByRole('button', { name: '+ Add Academic Year' }))
    await user.type(screen.getByPlaceholderText('e.g. 2025-2026'), '2027-2028')
    const dates = document.querySelectorAll('input[type=date]')
    await user.type(dates[0], '2027-04-01')
    await user.type(dates[1], '2028-03-31')
    await user.click(screen.getByRole('button', { name: /^(Create|Save anyway)$/ }))
    await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Academic year added'))
  })

  it('is read-only for a manager: no add, menu or terms buttons', async () => {
    auth.isSchoolAdmin = false
    renderWithProviders(<AcademicYearsPage />)
    await screen.findByText('2026-2027')
    expect(screen.queryByRole('button', { name: '+ Add Academic Year' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    expect(screen.queryByRole('button', { name: /terms/i })).toBeNull()
  })
})
