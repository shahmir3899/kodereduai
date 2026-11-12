import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import ParentsTab from './ParentsTab'
import ParentLinksDrawer from './ParentLinksDrawer'
import { parentStatusPill } from './parentLinkUtils'

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}))

const khan = { id: 7, full_name: 'Mr Khan', username: 'mrkhan', phone: '0300-1234567', email: '', relation_to_default: 'FATHER' }
const students = [
  { id: 1, name: 'Ali Khan', class_name: '5-A', roll_number: '1' },
  { id: 2, name: 'Sara Khan', class_name: '3-B', roll_number: '2' },
  { id: 3, name: 'Bilal Raza', class_name: '5-B', roll_number: '3' },
]

function mockParents(children = [{ link_id: 11, student_id: 1, student_name: 'Ali Khan', class_name: '5-A', relation: 'FATHER', is_primary: true, can_pickup: true }]) {
  server.use(http.get('/api/parents/admin/parents/', () =>
    HttpResponse.json([{ parent: khan, children, child_count: children.length }])))
}

describe('parentStatusPill', () => {
  it('prefers linked over pending and defaults to not linked', () => {
    expect(parentStatusPill({ linked: 2, pending: 1 })).toMatchObject({ key: 'linked', label: '2 parents linked' })
    expect(parentStatusPill({ linked: 0, pending: 1 }).key).toBe('pending')
    expect(parentStatusPill(undefined).key).toBe('none')
  })
})

describe('ParentsTab', () => {
  it('lists parents with children and links several selected students in one call', async () => {
    mockParents()
    let body = null
    server.use(http.post('/api/parents/admin/link-children/', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ linked: [{}, {}], skipped: [] }, { status: 201 })
    }))
    const user = userEvent.setup()
    renderWithProviders(<ParentsTab students={students} />)

    expect(await screen.findByText('Mr Khan')).toBeInTheDocument()
    expect(screen.getByText('1 child', { selector: 'span' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Manage' }))

    const drawer = await screen.findByRole('dialog', { name: 'Mr Khan' })
    // Ali is already linked, so only the other two can be picked.
    expect(within(drawer).queryByRole('checkbox', { name: /Ali Khan/ })).not.toBeInTheDocument()
    await user.click(within(drawer).getByLabelText(/Sara Khan/))
    await user.click(within(drawer).getByLabelText(/Bilal Raza/))
    await user.click(within(drawer).getByRole('button', { name: 'Link 2 selected' }))

    await waitFor(() => expect(body).toEqual({
      parent_profile_id: 7, student_ids: [2, 3], relation: 'FATHER', is_primary: false,
    }))
  })

  it('sends the 2+ children filter', async () => {
    const seen = []
    server.use(http.get('/api/parents/admin/parents/', ({ request }) => {
      seen.push(new URL(request.url).searchParams.get('children'))
      return HttpResponse.json([])
    }))
    const user = userEvent.setup()
    renderWithProviders(<ParentsTab students={students} />)
    await user.selectOptions(await screen.findByLabelText('Children filter'), 'multi')
    await waitFor(() => expect(seen).toContain('multi'))
  })
})

describe('ParentLinksDrawer', () => {
  it('shows linked parents and sibling suggestions, and links the ticked sibling to the same parent', async () => {
    mockParents()
    server.use(
      http.get('/api/parents/admin/generate-invite/', () => HttpResponse.json([])),
      http.get('/api/parents/admin/sibling-suggestions/', () =>
        HttpResponse.json([{ student_id: 2, student_name: 'Sara Khan', class_name: '3-B', already_linked_to_other: false }])),
    )
    let body = null
    server.use(http.post('/api/parents/admin/link-children/', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ linked: [{}], skipped: [] }, { status: 201 })
    }))
    const user = userEvent.setup()
    renderWithProviders(<ParentLinksDrawer student={students[0]} onClose={() => {}} />)

    expect(await screen.findByText(/Mr Khan/)).toBeInTheDocument()
    const hint = await screen.findByTestId('sibling-suggestions')
    await user.click(within(hint).getByLabelText(/Sara Khan/))
    await user.click(within(hint).getByRole('button', { name: /Link 1 to Mr Khan/ }))

    await waitFor(() => expect(body).toEqual({ parent_profile_id: 7, student_ids: [2], relation: 'FATHER' }))
  })

  it('creates an invite for a parent who has no account yet', async () => {
    mockParents([])
    server.use(http.get('/api/parents/admin/generate-invite/', () => HttpResponse.json([])))
    let body = null
    server.use(http.post('/api/parents/admin/generate-invite/', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ id: 1, invite_code: 'ABC' }, { status: 201 })
    }))
    const user = userEvent.setup()
    renderWithProviders(<ParentLinksDrawer student={students[2]} onClose={() => {}} />)

    await user.selectOptions(await screen.findByLabelText('Invite relation'), 'MOTHER')
    await user.click(screen.getByRole('button', { name: 'Generate invite' }))
    await waitFor(() => expect(body).toEqual({ student_id: 3, relation: 'MOTHER', parent_phone: '' }))
  })
})
