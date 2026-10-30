import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
import { messagingApi } from '../../../services/api'
import ParentMessages from '../ParentMessages'

// Shapes from backend/messaging (list_threads, get_thread, list_recipients).
const THREAD = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001', other_participant_name: 'Ms Rana', student_name: 'Ayesha Khan',
  latest_message: 'See you Monday', latest_message_at: '2025-10-01T08:00:00Z', unread_count: 0,
}
const RECIPIENTS = [
  { id: 5, name: 'Ms Rana', role: 'TEACHER', student_id: 7, student_name: 'Ayesha Khan' },
  { id: 5, name: 'Ms Rana', role: 'TEACHER', student_id: 8, student_name: 'Bilal Khan' },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><ParentMessages /></MemoryRouter></QueryClientProvider>)
}

Element.prototype.scrollIntoView = vi.fn()

describe('ParentMessages on /api/messaging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    messagingApi.getThreads.mockResolvedValue({ data: [THREAD] })
    messagingApi.getRecipients.mockResolvedValue({ data: RECIPIENTS })
    messagingApi.getThread.mockResolvedValue({ data: { ...THREAD, messages: [
      { id: 1, body: 'Hello', sender_name: 'Me', is_mine: true, created_at: '2025-10-01T07:00:00Z' },
      { id: 2, body: 'See you Monday', sender_name: 'Ms Rana', is_mine: false, created_at: '2025-10-01T08:00:00Z' },
    ] } })
    messagingApi.createThread.mockResolvedValue({ data: { id: THREAD.id } })
    messagingApi.reply.mockResolvedValue({ data: {} })
    messagingApi.markRead.mockResolvedValue({})
  })

  it('lists threads and shows a thread\'s messages when opened', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Ms Rana'))
    expect(await screen.findByText('Hello')).toBeInTheDocument()
    expect(messagingApi.getThread).toHaveBeenCalledWith(THREAD.id)
  })

  it('replies in the open thread', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Ms Rana'))
    await screen.findByText('Hello')
    fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: 'Thanks' } })
    fireEvent.submit(screen.getByPlaceholderText('Type a message...').closest('form'))
    await waitFor(() => expect(messagingApi.reply).toHaveBeenCalledWith(THREAD.id, { message: 'Thanks' }))
  })

  it('starts a new message to a teacher about one child', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('New Message'))
    const select = await screen.findByRole('combobox')
    await screen.findByText(/Ayesha Khan/, { selector: 'option' })
    fireEvent.change(select, { target: { value: '5:8' } })
    fireEvent.change(screen.getByPlaceholderText('Type your message...'), { target: { value: 'Hi' } })
    fireEvent.click(screen.getByText('Send Message'))
    await waitFor(() => expect(messagingApi.createThread).toHaveBeenCalledWith({ recipient_user_id: 5, student_id: 8, message: 'Hi' }))
  })

  it('does not send a new message without a recipient', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('New Message'))
    fireEvent.change(await screen.findByPlaceholderText('Type your message...'), { target: { value: 'Hi' } })
    expect(screen.getByText('Send Message')).toBeDisabled()
  })

  it('names the icon-only buttons so a phone user and a screen reader can find them', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: 'New Message' })).toBeInTheDocument()
    fireEvent.click(await screen.findByText('Ms Rana'))
    expect(await screen.findByRole('button', { name: 'Back to conversations' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument()
  })
})
