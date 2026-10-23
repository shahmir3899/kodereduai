import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import RoutesPage from '../RoutesPage'

// Mock AuthContext
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    effectiveRole: 'SCHOOL_ADMIN',
    activeSchool: { id: 1, name: 'Test School' },
  }),
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}))

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2026' } }),
}))

async function expandFirstRoute(user) {
  await waitFor(() => expect(screen.getByText('Route North')).toBeInTheDocument())
  const toggles = screen.getAllByRole('button', { name: /^stops$|route north/i })
  await user.click(toggles[0])
}

describe('RoutesPage - stop_order field name', () => {
  it('renders stops with stop_order displayed', async () => {
    renderWithProviders(<RoutesPage />)
    await expandFirstRoute(userEvent.setup())
    expect(await screen.findByText(/Stop A/)).toBeInTheDocument()
    expect(screen.getByText(/Stop B/)).toBeInTheDocument()
  })

  it('sends stop_order (not order) when creating a stop', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/transport/stops/', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 4, ...capturedBody }, { status: 201 })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<RoutesPage />)
    await expandFirstRoute(user)

    await user.click((await screen.findAllByRole('button', { name: /add stop/i }))[0])
    await user.type(screen.getByPlaceholderText(/stop name|main gate/i), 'New Stop')
    fireEvent.change(screen.getByLabelText(/pickup time/i), { target: { value: '07:30' } })
    fireEvent.change(screen.getByLabelText(/drop time/i), { target: { value: '14:30' } })

    const submit = screen.getAllByRole('button', { name: /^add stop$/i }).pop()
    await user.click(submit)

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect(capturedBody).toHaveProperty('stop_order', 3)
    expect(capturedBody).not.toHaveProperty('order')
  })

  it('does not enable Add Stop until pickup and drop times are set', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RoutesPage />)
    await expandFirstRoute(user)
    await user.click((await screen.findAllByRole('button', { name: /add stop/i }))[0])
    await user.type(screen.getByPlaceholderText(/stop name|main gate/i), 'New Stop')
    expect(screen.getAllByRole('button', { name: /^add stop$/i }).pop()).toBeDisabled()
  })

  it('stops are sorted by stop_order', async () => {
    server.use(
      http.get('/api/transport/stops/', () =>
        HttpResponse.json([
          { id: 2, route: 1, name: 'Stop B', stop_order: 2, pickup_time: '07:40', drop_time: '14:20' },
          { id: 1, route: 1, name: 'Stop A', stop_order: 1, pickup_time: '07:30', drop_time: '14:30' },
        ])
      )
    )

    renderWithProviders(<RoutesPage />)
    await expandFirstRoute(userEvent.setup())

    await waitFor(() => {
      const text = document.body.textContent
      expect(text.indexOf('Stop A')).toBeGreaterThan(-1)
      expect(text.indexOf('Stop A')).toBeLessThan(text.indexOf('Stop B'))
    })
  })
})
