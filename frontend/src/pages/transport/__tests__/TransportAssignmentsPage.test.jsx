import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import TransportAssignmentsPage from '../TransportAssignmentsPage'

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
  useAcademicYear: () => ({ activeAcademicYear: { id: 7, name: '2026-27' } }),
}))

async function fillForm(user) {
  await user.click(await screen.findByRole('button', { name: /new assignment/i }))
  await user.click((await screen.findAllByRole('button', { name: /Roll #/ }))[0])
  await user.selectOptions(screen.getByLabelText(/^route/i), '1')
  await screen.findByRole('option', { name: /#1 Stop A/ })
}

describe('TransportAssignmentsPage - request contract', () => {
  it('lists stops by stop_order and posts academic_year with a single assignment', async () => {
    let body = null
    server.use(
      http.post('/api/transport/assignments/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 9, ...body }, { status: 201 })
      })
    )
    const user = userEvent.setup()
    renderWithProviders(<TransportAssignmentsPage />)
    await fillForm(user)

    const submit = screen.getByRole('button', { name: /^assign 1 student$/i })
    expect(submit).toBeDisabled() // a stop is required
    await user.selectOptions(screen.getByLabelText(/^stop/i), '1')
    await user.click(submit)

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ academic_year: 7, student: 1, route: 1, stop: 1, transport_type: 'BOTH' })
  })

  it('sends the *_id field names the bulk endpoint expects', async () => {
    let body = null
    server.use(
      http.post('/api/transport/assignments/bulk_assign/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ created: 2, skipped: 0, total_requested: 2 }, { status: 201 })
      })
    )
    const user = userEvent.setup()
    renderWithProviders(<TransportAssignmentsPage />)
    await user.click(await screen.findByRole('button', { name: /new assignment/i }))
    await user.click((await screen.findAllByRole('button', { name: /Roll #/ }))[0])
    await user.click((await screen.findAllByRole('button', { name: /Roll #/ }))[0])
    await user.selectOptions(screen.getByLabelText(/^route/i), '1')
    await screen.findByRole('option', { name: /#1 Stop A/ })
    await user.selectOptions(screen.getByLabelText(/^stop/i), '1')
    await user.click(screen.getByRole('button', { name: /^assign \d+ students$/i }))

    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ academic_year_id: 7, route_id: 1, stop_id: 1 })
    expect(body).not.toHaveProperty('route')
    expect(body).not.toHaveProperty('stop')
  })

  it('filters assignments with route_id', async () => {
    const seen = []
    server.use(
      http.get('/api/transport/assignments/', ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return HttpResponse.json([])
      })
    )
    const user = userEvent.setup()
    renderWithProviders(<TransportAssignmentsPage />)
    await screen.findByRole('option', { name: 'Route North' })
    await user.selectOptions(screen.getByLabelText(/filter by route/i), '1')
    await waitFor(() => expect(seen.some((p) => p.get('route_id') === '1')).toBe(true))
  })
})
