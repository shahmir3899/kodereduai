import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../services/api', () => ({
  messagingApi: {
    getThreads: vi.fn(),
    getThread: vi.fn(),
    getRecipients: vi.fn(),
    createThread: vi.fn(),
    reply: vi.fn(),
    markRead: vi.fn(),
  },
}))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'SCHOOL_ADMIN' } }) }))
import { messagingApi } from '../../../services/api'
import MessagesPage from '../MessagesPage'

const THREAD = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001', other_participant_name: 'Sara Ahmed', student_name: null,
  subject: 'Class 1-A trip', latest_message: 'May I take Class 1-A on a trip?', latest_message_at: '2025-10-01T08:00:00Z', unread_count: 1,
}

Element.prototype.scrollIntoView = vi.fn()

// Below 640 px the "New Message" label is hidden, so the button's name must come from aria-label.
describe('MessagesPage icon-only buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    messagingApi.getThreads.mockResolvedValue({ data: [THREAD] })
    messagingApi.getRecipients.mockResolvedValue({ data: [] })
    messagingApi.getThread.mockResolvedValue({ data: { ...THREAD, messages: [] } })
    messagingApi.markRead.mockResolvedValue({})
  })

  it('names the new-message, back and send buttons', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={qc}><MemoryRouter><MessagesPage /></MemoryRouter></QueryClientProvider>)
    expect(await screen.findByRole('button', { name: 'New Message' })).toBeInTheDocument()
    fireEvent.click(await screen.findByText('Class 1-A trip'))
    expect(await screen.findByRole('button', { name: 'Back to conversations' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument()
  })
})
